import React, { useMemo, useState } from 'react';
import { shellCommandCatalog, shellCommandCategories, ShellCommandDefinition } from 'data/shellCommandCatalog';

interface ShellCommandPanelProps {
  onSend: (command: string) => Promise<unknown> | void;
}

const getDefaultPayload = (command: ShellCommandDefinition): string => {
  if (command.syntax && command.syntax.includes('<')) {
    return command.syntax;
  }
  if (command.command === 'flash' || command.command === 'rohm_mspi_dbg' || command.command === 'rohm_sr') {
    return command.command;
  }
  return command.command;
};

const ShellCommandPanel: React.FC<ShellCommandPanelProps> = ({ onSend }) => {
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const filteredCommands = useMemo(
    () =>
      shellCommandCatalog.filter((command) =>
        categoryFilter === 'all' ? true : command.category === categoryFilter
      ),
    [categoryFilter]
  );

  const autoCommands = useMemo(
    () => shellCommandCatalog.filter((command) => command.isAuto),
    []
  );

  return (
    <section className="terminal__shell-command-panel">
      <div className="terminal__shell-title">Shell Command Map</div>

      <div className="terminal__shell-toolbar">
        <select
          className="terminal__shell-select"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="all">전체</option>
          {shellCommandCategories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <button
          className="btn btn--secondary btn--sm"
          onClick={async () => {
            for (const command of autoCommands) {
              await onSend(command.command);
            }
          }}
          title="version, flashmgr_boot 자동 실행"
        >
          AUTO_CMD 실행
        </button>
      </div>

      <div className="terminal__shell-grid">
        {filteredCommands.map((entry) => (
          <button
            key={entry.command}
            className="terminal__shell-chip"
            onClick={() => onSend(getDefaultPayload(entry))}
            title={`${entry.command} -> ${entry.handler}`}
          >
            <span className="terminal__shell-chip-name">{entry.command}</span>
            <span className="terminal__shell-chip-desc">{entry.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
};

export default ShellCommandPanel;
