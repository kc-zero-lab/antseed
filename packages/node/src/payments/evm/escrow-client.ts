import { Contract, JsonRpcProvider, type AbstractSigner } from 'ethers';

export interface EscrowConfig {
  /** Base JSON-RPC endpoint (e.g. https://mainnet.base.org) */
  rpcUrl: string;
  /** Deployed AntseedEscrow contract address */
  contractAddress: string;
  /** USDC token contract address */
  usdcAddress: string;
  /** Chain ID (8453 = Base mainnet, 84532 = Base Sepolia) */
  chainId: number;
}

export interface BuyerBalance {
  available:        bigint;
  pendingWithdrawal: bigint;
  withdrawalReadyAt: number;  // unix seconds; 0 if no pending withdrawal
}

export interface SessionAuthInfo {
  nonce:    number;
  authMax:  bigint;
  authUsed: bigint;
  deadline: number;
}

export interface ReputationData {
  avgRating:          number;
  ratingCount:        number;
  stakedAmount:       bigint;
  totalTransactions:  number;
  totalVolume:        bigint;
  uniqueBuyersServed: number;
  ageDays:            number;
}

export interface DisputeInfo {
  frozenAmount: bigint;
  openedAt:     number;
  resolved:     boolean;
}

// ─── Minimal ERC-20 ABI ──────────────────────────────────────────────────────

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
] as const;

// ─── AntseedEscrow ABI ───────────────────────────────────────────────────────

const ESCROW_ABI = [
  // Buyer
  'function deposit(uint256 amount) external',
  'function requestWithdrawal(uint256 amount) external',
  'function executeWithdrawal() external',
  'function cancelWithdrawal() external',

  // Seller
  'function charge(address buyer, uint256 amount, bytes32 sessionId, uint256 maxAmount, uint256 nonce, uint256 deadline, bytes calldata sig) external',
  'function claimEarnings() external',
  'function stake(uint256 amount) external',
  'function unstake(uint256 amount) external',

  // Platform
  'function sweepFees() external',

  // Dispute
  'function openDispute(address seller, uint256 claimedAmount) external',
  'function resolveDispute(address buyer, address seller, bool buyerWins) external',

  // Reputation
  'function rateSeller(address seller, uint8 score) external',
  'function canRate(address buyer, address seller) external view returns (bool)',
  'function getReputation(address seller) external view returns (tuple(uint256 avgRating, uint256 ratingCount, uint256 stakedAmount, uint256 totalTransactions, uint256 totalVolume, uint256 uniqueBuyersServed, uint256 ageDays))',

  // Views
  'function getBuyerBalance(address buyer) external view returns (uint256 available, uint256 pendingWithdrawal, uint256 withdrawalReadyAt)',
  'function getSessionAuth(address buyer, address seller, bytes32 sessionId) external view returns (uint256 nonce, uint256 authMax, uint256 authUsed, uint256 deadline)',
  'function getDispute(address buyer, address seller) external view returns (uint256 frozenAmount, uint256 openedAt, bool resolved)',

  // State reads
  'function buyers(address) external view returns (uint256 balance, uint256 withdrawalAmount, uint256 withdrawalRequestedAt, uint256 firstTransactionAt, uint256 uniqueSellersCount)',
  'function sellers(address) external view returns (uint256 pendingEarnings, uint256 frozenEarnings, uint256 stakedAmount, uint256 stakedSince, uint256 firstTransactionAt, uint256 totalTransactions, uint256 totalVolume, uint256 uniqueBuyersCount)',
  'function hasInteracted(address buyer, address seller) external view returns (bool)',
  'function accumulatedFees() external view returns (uint256)',
  'function platformFeeBps() external view returns (uint16)',
  'function paused() external view returns (bool)',
  'function DOMAIN_SEPARATOR() external view returns (bytes32)',
] as const;

// ─── Client ──────────────────────────────────────────────────────────────────

export class EscrowClient {
  private readonly _provider: JsonRpcProvider;
  private readonly _contractAddress: string;
  private readonly _usdcAddress: string;
  private readonly _chainId: number;
  /** Local nonce cache to avoid pending-tx collisions */
  private readonly _nonceCursor = new Map<string, number>();

  constructor(config: EscrowConfig) {
    this._provider        = new JsonRpcProvider(config.rpcUrl);
    this._contractAddress = config.contractAddress;
    this._usdcAddress     = config.usdcAddress;
    this._chainId         = config.chainId;
  }

  get provider():         JsonRpcProvider { return this._provider; }
  get contractAddress():  string          { return this._contractAddress; }
  get usdcAddress():      string          { return this._usdcAddress; }
  get chainId():          number          { return this._chainId; }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private _connected(signer: AbstractSigner): AbstractSigner {
    return signer.provider ? signer : signer.connect(this._provider);
  }

  private async _reserveNonce(address: string): Promise<number> {
    const network = await this._provider.getTransactionCount(address, 'pending');
    const cached  = this._nonceCursor.get(address);
    const nonce   = cached === undefined ? network : Math.max(network, cached);
    this._nonceCursor.set(address, nonce + 1);
    return nonce;
  }

  private async _prepareWrite(signer: AbstractSigner): Promise<{ contract: Contract; nonce: number }> {
    const s       = this._connected(signer);
    const addr    = await s.getAddress();
    const nonce   = await this._reserveNonce(addr);
    const contract = new Contract(this._contractAddress, ESCROW_ABI, s);
    return { contract, nonce };
  }

  private _readContract(): Contract {
    return new Contract(this._contractAddress, ESCROW_ABI, this._provider);
  }

  private _usdcContract(signer: AbstractSigner): Contract {
    return new Contract(this._usdcAddress, ERC20_ABI, this._connected(signer));
  }

  // ── ERC-20 approval (shared by deposit + stake) ───────────────────────────

  private async _approveIfNeeded(signer: AbstractSigner, amount: bigint): Promise<void> {
    const s       = this._connected(signer);
    const addr    = await s.getAddress();
    const usdc    = this._usdcContract(signer);
    const current = await usdc.getFunction('allowance')(addr, this._contractAddress) as bigint;
    if (current >= amount) return;
    const nonce = await this._reserveNonce(addr);
    const tx    = await usdc.getFunction('approve')(this._contractAddress, amount, { nonce });
    await tx.wait();
  }

  // ── Buyer operations ──────────────────────────────────────────────────────

  async deposit(signer: AbstractSigner, amount: bigint): Promise<string> {
    await this._approveIfNeeded(signer, amount);
    const { contract, nonce } = await this._prepareWrite(signer);
    const tx = await contract.getFunction('deposit')(amount, { nonce });
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async requestWithdrawal(signer: AbstractSigner, amount: bigint): Promise<string> {
    const { contract, nonce } = await this._prepareWrite(signer);
    const tx = await contract.getFunction('requestWithdrawal')(amount, { nonce });
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async executeWithdrawal(signer: AbstractSigner): Promise<string> {
    const { contract, nonce } = await this._prepareWrite(signer);
    const tx = await contract.getFunction('executeWithdrawal')({ nonce });
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async cancelWithdrawal(signer: AbstractSigner): Promise<string> {
    const { contract, nonce } = await this._prepareWrite(signer);
    const tx = await contract.getFunction('cancelWithdrawal')({ nonce });
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ── Seller operations ─────────────────────────────────────────────────────

  async charge(
    seller:    AbstractSigner,
    buyer:     string,
    amount:    bigint,
    sessionId: string,   // 0x-prefixed bytes32
    maxAmount: bigint,
    authNonce: number,
    deadline:  number,
    sig:       string,   // 0x-prefixed 65-byte ECDSA sig
  ): Promise<string> {
    const { contract, nonce } = await this._prepareWrite(seller);
    const tx = await contract.getFunction('charge')(
      buyer, amount, sessionId, maxAmount, authNonce, deadline, sig,
      { nonce },
    );
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async claimEarnings(seller: AbstractSigner): Promise<string> {
    const { contract, nonce } = await this._prepareWrite(seller);
    const tx = await contract.getFunction('claimEarnings')({ nonce });
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async stake(signer: AbstractSigner, amount: bigint): Promise<string> {
    await this._approveIfNeeded(signer, amount);
    const { contract, nonce } = await this._prepareWrite(signer);
    const tx = await contract.getFunction('stake')(amount, { nonce });
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async unstake(signer: AbstractSigner, amount: bigint): Promise<string> {
    const { contract, nonce } = await this._prepareWrite(signer);
    const tx = await contract.getFunction('unstake')(amount, { nonce });
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ── Platform ──────────────────────────────────────────────────────────────

  async sweepFees(signer: AbstractSigner): Promise<string> {
    const { contract, nonce } = await this._prepareWrite(signer);
    const tx = await contract.getFunction('sweepFees')({ nonce });
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ── Dispute ───────────────────────────────────────────────────────────────

  async openDispute(buyer: AbstractSigner, seller: string, claimedAmount: bigint): Promise<string> {
    const { contract, nonce } = await this._prepareWrite(buyer);
    const tx = await contract.getFunction('openDispute')(seller, claimedAmount, { nonce });
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async resolveDispute(
    arbiter:   AbstractSigner,
    buyer:     string,
    seller:    string,
    buyerWins: boolean,
  ): Promise<string> {
    const { contract, nonce } = await this._prepareWrite(arbiter);
    const tx = await contract.getFunction('resolveDispute')(buyer, seller, buyerWins, { nonce });
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ── Reputation ────────────────────────────────────────────────────────────

  async rateSeller(buyer: AbstractSigner, seller: string, score: number): Promise<string> {
    const { contract, nonce } = await this._prepareWrite(buyer);
    const tx = await contract.getFunction('rateSeller')(seller, score, { nonce });
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async canRate(buyerAddr: string, sellerAddr: string): Promise<boolean> {
    return this._readContract().getFunction('canRate')(buyerAddr, sellerAddr) as Promise<boolean>;
  }

  async getReputation(sellerAddr: string): Promise<ReputationData> {
    const r = await this._readContract().getFunction('getReputation')(sellerAddr);
    return {
      avgRating:          Number(r.avgRating),
      ratingCount:        Number(r.ratingCount),
      stakedAmount:       r.stakedAmount as bigint,
      totalTransactions:  Number(r.totalTransactions),
      totalVolume:        r.totalVolume as bigint,
      uniqueBuyersServed: Number(r.uniqueBuyersServed),
      ageDays:            Number(r.ageDays),
    };
  }

  // ── View helpers ──────────────────────────────────────────────────────────

  async getBuyerBalance(buyerAddr: string): Promise<BuyerBalance> {
    const r = await this._readContract().getFunction('getBuyerBalance')(buyerAddr);
    return {
      available:         r[0] as bigint,
      pendingWithdrawal: r[1] as bigint,
      withdrawalReadyAt: Number(r[2]),
    };
  }

  async getSessionAuth(
    buyerAddr:  string,
    sellerAddr: string,
    sessionId:  string,
  ): Promise<SessionAuthInfo> {
    const r = await this._readContract().getFunction('getSessionAuth')(buyerAddr, sellerAddr, sessionId);
    return {
      nonce:    Number(r[0]),
      authMax:  r[1] as bigint,
      authUsed: r[2] as bigint,
      deadline: Number(r[3]),
    };
  }

  async getDispute(buyerAddr: string, sellerAddr: string): Promise<DisputeInfo> {
    const r = await this._readContract().getFunction('getDispute')(buyerAddr, sellerAddr);
    return {
      frozenAmount: r[0] as bigint,
      openedAt:     Number(r[1]),
      resolved:     r[2] as boolean,
    };
  }

  async getAccumulatedFees(): Promise<bigint> {
    return this._readContract().getFunction('accumulatedFees')() as Promise<bigint>;
  }

  async getPlatformFeeBps(): Promise<number> {
    const bps = await this._readContract().getFunction('platformFeeBps')();
    return Number(bps);
  }

  async isPaused(): Promise<boolean> {
    return this._readContract().getFunction('paused')() as Promise<boolean>;
  }

  async getSellerPendingEarnings(sellerAddr: string): Promise<bigint> {
    const r = await this._readContract().getFunction('sellers')(sellerAddr);
    return r[0] as bigint; // pendingEarnings
  }

  async getUSDCBalance(ownerAddr: string): Promise<bigint> {
    const usdc = new Contract(this._usdcAddress, ERC20_ABI, this._provider);
    return usdc.getFunction('balanceOf')(ownerAddr) as Promise<bigint>;
  }
}

// ── Legacy export alias ───────────────────────────────────────────────────────
/** @deprecated Use EscrowClient. */
export { EscrowClient as BaseEscrowClient };
export type { EscrowConfig as BaseEscrowConfig };
