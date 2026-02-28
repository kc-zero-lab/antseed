import { type AbstractSigner, type TypedDataDomain, getBytes } from 'ethers';
import type { Identity } from '../../p2p/identity.js';
import { signData, verifySignature } from '../../p2p/identity.js';

// =========================================================================
// EIP-712 — SpendingAuth (on-chain, verified by AntseedEscrow.charge())
// =========================================================================

export const SPENDING_AUTH_TYPES: Record<string, import('ethers').TypedDataField[]> = {
  SpendingAuth: [
    { name: 'seller',    type: 'address' },
    { name: 'sessionId', type: 'bytes32' },
    { name: 'maxAmount', type: 'uint256' },
    { name: 'nonce',     type: 'uint256' },
    { name: 'deadline',  type: 'uint256' },
  ],
};

export interface SpendingAuthMessage {
  seller:    string;
  sessionId: string;
  maxAmount: bigint;
  nonce:     number;
  deadline:  number;
}

export function makeEscrowDomain(chainId: number, contractAddress: string): TypedDataDomain {
  return {
    name:              'AntseedEscrow',
    version:           '1',
    chainId,
    verifyingContract: contractAddress,
  };
}

/**
 * Sign an EIP-712 SpendingAuth using an ethers signer.
 * Returns the 65-byte ECDSA signature as a 0x-prefixed hex string.
 */
export async function signSpendingAuth(
  signer:          AbstractSigner,
  domain:          TypedDataDomain,
  msg:             SpendingAuthMessage,
): Promise<string> {
  return signer.signTypedData(domain, SPENDING_AUTH_TYPES, msg);
}

// =========================================================================
// Ed25519 signatures (off-chain P2P) — bilateral receipt proof
// =========================================================================

export function buildReceiptMessage(
  sessionId:    Uint8Array,
  runningTotal: bigint,
  requestCount: number,
  responseHash: Uint8Array,
): Uint8Array {
  if (sessionId.length   !== 32) throw new Error(`sessionId must be 32 bytes, got ${sessionId.length}`);
  if (responseHash.length !== 32) throw new Error(`responseHash must be 32 bytes, got ${responseHash.length}`);
  const msg = new Uint8Array(76);
  msg.set(sessionId, 0);
  const totalBuf = new ArrayBuffer(8);
  new DataView(totalBuf).setBigUint64(0, runningTotal, true);
  msg.set(new Uint8Array(totalBuf), 32);
  const countBuf = new ArrayBuffer(4);
  new DataView(countBuf).setUint32(0, requestCount, true);
  msg.set(new Uint8Array(countBuf), 40);
  msg.set(responseHash, 44);
  return msg;
}

export function buildAckMessage(
  sessionId:    Uint8Array,
  runningTotal: bigint,
  requestCount: number,
): Uint8Array {
  if (sessionId.length !== 32) throw new Error(`sessionId must be 32 bytes, got ${sessionId.length}`);
  const msg = new Uint8Array(44);
  msg.set(sessionId, 0);
  const totalBuf = new ArrayBuffer(8);
  new DataView(totalBuf).setBigUint64(0, runningTotal, true);
  msg.set(new Uint8Array(totalBuf), 32);
  const countBuf = new ArrayBuffer(4);
  new DataView(countBuf).setUint32(0, requestCount, true);
  msg.set(new Uint8Array(countBuf), 40);
  return msg;
}

export async function signMessageEd25519(
  identity: Identity,
  message:  Uint8Array,
): Promise<Uint8Array> {
  return signData(identity.privateKey, message);
}

export async function verifyMessageEd25519(
  publicKey: Uint8Array,
  signature: Uint8Array,
  message:   Uint8Array,
): Promise<boolean> {
  return verifySignature(publicKey, signature, message);
}

// ── Legacy helpers (kept for backward compatibility with receipt/ack tests) ──

/** @deprecated Use signSpendingAuth + EIP-712 instead. */
export async function signMessageEcdsa(
  signer:      AbstractSigner,
  messageHash: string,
): Promise<string> {
  return signer.signMessage(getBytes(messageHash));
}
