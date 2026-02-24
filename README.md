# Antseed CLI + Dashboard

Command-line interface and web dashboard for the Antseed Network -- a P2P marketplace for reselling idle LLM plan capacity.

## Commands

| Command | Description |
|---------|-------------|
| `antseed init` | Install trusted provider and router plugins |
| `antseed seed` | Start seeding your idle LLM capacity to the P2P network |
| `antseed connect` | Start the buyer proxy and connect to sellers |
| `antseed plugin add <pkg>` | Install a provider or router plugin from npm |
| `antseed plugin remove <name>` | Remove an installed plugin |
| `antseed plugin list` | List installed plugins |
| `antseed status` | Show current node status |
| `antseed config` | Manage configuration (`show`, `set`, `seller show/set`, `buyer show/set`, `init`) |
| `antseed dashboard` | Start the web dashboard for monitoring and configuration |
| `antseed dev` | Run seller + buyer locally for development and testing |
| `antseed browse` | Browse available models, prices, and reputation on the network |

## Plugins

Antseed uses an open plugin ecosystem. Plugins are installed into `~/.antseed/plugins/` via npm.

**Providers** connect your node to an upstream AI API (seeder mode):

```bash
antseed plugin add antseed-provider-anthropic
antseed seed --provider anthropic
```

**Routers** select peers and proxy requests (consumer mode):

```bash
antseed plugin add antseed-router-claude-code
antseed connect --router claude-code
```

Run `antseed init` to install all trusted plugins interactively.

## Configuration

Configuration is stored at `~/.antseed/config.json` by default. Use `-c` / `--config` to specify an alternative path.

Runtime env variables are loaded via `dotenv` from `.env.local` and `.env` in the current working directory.
See `.env.example` for supported keys.

Enable debug logs with either:

```bash
antseed -v <command>
```

or:

```bash
ANTSEED_DEBUG=1 antseed <command>
```

For dashboard frontend debug logging, set:

```bash
VITE_ANTSEED_DEBUG=1
```

Initialize a new config:

```bash
antseed config init
```

Pricing is configured in USD per 1M tokens with role-specific defaults and optional provider/model overrides:

```json
{
  "seller": {
    "pricing": {
      "defaults": {
        "inputUsdPerMillion": 10,
        "outputUsdPerMillion": 10
      },
      "providers": {
        "anthropic": {
          "models": {
            "claude-sonnet-4-5-20250929": {
              "inputUsdPerMillion": 12,
              "outputUsdPerMillion": 18
            }
          }
        }
      }
    }
  },
  "buyer": {
    "preferredProviders": ["anthropic", "openai"],
    "maxPricing": {
      "defaults": {
        "inputUsdPerMillion": 100,
        "outputUsdPerMillion": 100
      }
    }
  }
}
```

Role-first config examples:

```bash
# Seller defaults
antseed config seller set pricing.defaults.inputUsdPerMillion 12
antseed config seller set pricing.defaults.outputUsdPerMillion 36

# Seller per-model override for a provider
antseed config seller set pricing.providers.anthropic.models '{"claude-sonnet-4-5-20250929":{"inputUsdPerMillion":14,"outputUsdPerMillion":42}}'

# Buyer preferences and max pricing
antseed config buyer set preferredProviders '["anthropic","openai"]'
antseed config buyer set maxPricing.defaults.inputUsdPerMillion 25
antseed config buyer set maxPricing.defaults.outputUsdPerMillion 75
```

Runtime-only overrides (do not write your config file):

```bash
antseed seed --provider anthropic --input-usd-per-million 10 --output-usd-per-million 30
antseed connect --router claude-code --max-input-usd-per-million 20 --max-output-usd-per-million 60
```

## Settlement Runtime (Seeder)

`antseed seed` can enable automatic session settlement when payment config is present.
`antseed connect` can also enable buyer-side escrow/session locking with the same payment config.

Common runtime env controls:
- `ANTSEED_ENABLE_SETTLEMENT=true|false`
- `ANTSEED_SETTLEMENT_IDLE_MS=30000`
- `ANTSEED_DEFAULT_ESCROW_USDC=1`
- `ANTSEED_AUTO_FUND_ESCROW=true|false`
- `ANTSEED_SELLER_WALLET_ADDRESS=0x...`

Crypto settlement also requires `config.payments.crypto` values in your config file:
- `chainId` (`base` or `arbitrum`)
- `rpcUrl`
- `escrowContractAddress`
- `usdcContractAddress`

If `ANTSEED_ENABLE_SETTLEMENT` is not explicitly set and the RPC endpoint is unreachable,
the CLI now auto-disables settlement for that run and logs a warning instead of looping RPC network-detection errors.
Set `ANTSEED_ENABLE_SETTLEMENT=true` to force-enable settlement checks.

Runtime behavior:
- session opens -> optional escrow deposit
- session finalizes -> exact on-chain split settlement (`seller payout + platform fee + buyer refund remainder`)
- no receipts -> escrow refund path

Provider middleware and agentic seeding are configured via provider plugin env keys (for Anthropic: `ANTSEED_SKILL_INJECT`, `ANTSEED_SKILL_TRIM_REGEX`, `ANTSEED_ENABLE_AGENTIC_SEEDER`).

## Development

```bash
npm install
npm run build
npm run dev
```

## Links

- Node SDK: `@antseed/node` (`../node`)
