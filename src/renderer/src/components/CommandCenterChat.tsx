import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { ThreadsPanel } from './ThreadsPanel';
import { MessageQueueComposer } from './MessageQueueComposer';
import type { Agent } from '@/store/store';

/**
 * The Command Center's DEFAULT surface: a natural-language directive board.
 *
 * AIRA is talked to here, not commanded with syntax. The upper pane is her
 * actual hive conversations (ThreadsPanel — AIRA's inbox grouped into threads,
 * with an inline reply box that posts back through the real hive), and the
 * composer underneath posts a fresh directive. AIRA decides whether to answer,
 * act, or delegate to a planet (planets wake lazily on first assignment). The
 * classic terminal is one click away and untouched elsewhere in the app.
 */
export function CommandCenterChat({ agent, onOpenTerminal }: { agent: Agent; onOpenTerminal: () => void }) {
  const { t } = useTranslation();
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '10px 12px 12px', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{
          fontFamily: 'var(--cth-font-display)', fontSize: 10, lineHeight: '14px', color: 'var(--cth-ink-900)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}>
          {t('commandCenter.chat.title')}
        </span>
        <span style={{
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-500)'
        }}>
          {t('commandCenter.chat.subtitle', { name: agent.name })}
        </span>
        <PixelButton size="sm" onClick={onOpenTerminal}>{t('commandCenter.chat.openTerminal')}</PixelButton>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <ThreadsPanel agentId={agent.id} key={agent.id} />
      </div>
      <MessageQueueComposer agent={agent} />
    </div>
  );
}