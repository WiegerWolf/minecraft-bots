import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { BotConfig } from '../types';

interface RoleSelectorProps {
  availableRoles: BotConfig[];
  selectedIndex: number;
  onSelect: (config: BotConfig) => void;
  onCancel: () => void;
  onNavigate: (delta: number) => void;
}

export function RoleSelector({ availableRoles, selectedIndex, onSelect, onCancel, onNavigate }: RoleSelectorProps) {
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
    } else if (key.return) {
      const selected = availableRoles[selectedIndex];
      if (selected) {
        onSelect(selected);
      }
    } else if (input === 'l' || key.rightArrow) {
      onNavigate(1);
    } else if (input === 'h' || key.leftArrow) {
      onNavigate(-1);
    }
  });

  return (
    <Box
      paddingX={1}
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      gap={1}
    >
      <Text>Add bot:</Text>
      {availableRoles.map((config, index) => (
        <Text key={config.role} color={index === selectedIndex ? 'cyan' : undefined} bold={index === selectedIndex}>
          {index === selectedIndex ? '>' : ' '}
          {config.roleLabel}
        </Text>
      ))}
      <Text dimColor>| h/l or arrows to select, Enter to add, Esc to cancel</Text>
    </Box>
  );
}
