import { useState, useCallback } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ComputerTerminal01Icon } from '@hugeicons/core-free-icons';
import { useUiSnapshot } from '../../hooks/useUiSnapshot';
import styles from './ExternalClientsView.module.scss';

type ExternalClientsViewProps = {
  active: boolean;
};

type ToolCard = {
  name: string;
  description: string;
  envVar: string;
  getValue: (port: number) => string;
  hint: string;
};

const TOOLS: ToolCard[] = [
  {
    name: 'Claude Code',
    description: 'Set the base URL before running claude, or export it in your shell profile.',
    envVar: 'ANTHROPIC_BASE_URL',
    getValue: (port) => `http://localhost:${port}`,
    hint: 'ANTHROPIC_BASE_URL=http://localhost:{port} claude',
  },
  {
    name: 'OpenCode',
    description: 'OpenCode uses the Anthropic API format. Point it at the local proxy.',
    envVar: 'ANTHROPIC_BASE_URL',
    getValue: (port) => `http://localhost:${port}`,
    hint: 'ANTHROPIC_BASE_URL=http://localhost:{port} opencode',
  },
  {
    name: 'Codex',
    description: 'OpenAI Codex CLI reads OPENAI_BASE_URL. Add /v1 to the proxy address.',
    envVar: 'OPENAI_BASE_URL',
    getValue: (port) => `http://localhost:${port}/v1`,
    hint: 'OPENAI_BASE_URL=http://localhost:{port}/v1 codex',
  },
  {
    name: 'Any OpenAI-compatible tool',
    description: 'Cursor, Continue.dev, and other tools that accept a custom OpenAI base URL.',
    envVar: 'Base URL',
    getValue: (port) => `http://localhost:${port}/v1`,
    hint: 'Set the OpenAI base URL in your tool\'s settings.',
  },
];

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [value]);

  return (
    <button
      className={`${styles.copyBtn}${copied ? ` ${styles.copied}` : ''}`}
      onClick={handleCopy}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function ExternalClientsView({ active }: ExternalClientsViewProps) {
  const { chatProxyStatus, chatProxyPort } = useUiSnapshot();
  const isOnline = chatProxyStatus.tone === 'active' && chatProxyPort > 0;

  return (
    <section className={`view${active ? ' active' : ''}`} role="tabpanel">
      <div className="page-header">
        <h2>External Clients</h2>
        <div className={`${styles.proxyBadge} ${isOnline ? styles.proxyOnline : styles.proxyOffline}`}>
          <span className={styles.proxyBadgeDot} />
          {isOnline ? `Proxy active on :${chatProxyPort}` : 'Proxy offline'}
        </div>
      </div>

      <div className={styles.content}>
        <p className={styles.sectionLabel}>Connect your tools</p>

        {!isOnline && (
          <div className={styles.offlineNote}>
            The local proxy is not running yet. Start the buyer runtime from the Overview page to enable external client access.
          </div>
        )}

        {TOOLS.map((tool) => {
          const value = isOnline ? tool.getValue(chatProxyPort) : tool.getValue(8377);
          const exportLine = `export ${tool.envVar}=${value}`;

          return (
            <div key={tool.name} className={styles.toolCard}>
              <div className={styles.toolHeader}>
                <div className={styles.toolIcon}>
                  <HugeiconsIcon icon={ComputerTerminal01Icon} size={16} strokeWidth={1.5} />
                </div>
                <span className={styles.toolName}>{tool.name}</span>
              </div>

              <p className={styles.toolDesc}>{tool.description}</p>

              <div className={styles.codeRow}>
                <span className={styles.codeLabel}>{tool.envVar}</span>
                <span className={styles.codeValue}>{value}</span>
                <CopyButton value={value} />
              </div>

              <div className={styles.codeRow}>
                <span className={styles.codeLabel}>export</span>
                <span className={styles.codeValue}>{exportLine}</span>
                <CopyButton value={exportLine} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
