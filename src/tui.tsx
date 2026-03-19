/**
 * tui.tsx — Two-pane ink TUI for claude-drive.
 * Layout: activity feed left, operator list right, Drive status bar at bottom.
 */
import { useState, useEffect, useRef } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import type { OperatorRegistry, OperatorContext } from "./operatorRegistry.js";
import type { DriveModeManager, DriveState } from "./driveMode.js";
import type { AgentOutputEmitter, DriveOutputEvent } from "./agentOutput.js";

export interface TuiOptions {
  registry: OperatorRegistry;
  driveMode: DriveModeManager;
  agentOutput: AgentOutputEmitter;
}

interface ActivityItem {
  id: number;
  text: string;
}

let _activityCounter = 0;

function ActivityPane({ agentOutput }: { agentOutput: AgentOutputEmitter }) {
  const [items, setItems] = useState<ActivityItem[]>([]);

  useEffect(() => {
    function handler(event: DriveOutputEvent) {
      let text: string;
      switch (event.type) {
        case "activity": text = `[${event.agent}] ${event.text}`; break;
        case "file": text = `[${event.agent}] ${event.action ?? "touched"} ${event.path}`; break;
        case "decision": text = `[${event.agent}] Decision: ${event.text}`; break;
        default: return;
      }
      const id = _activityCounter++;
      setItems((prev) => [...prev.slice(-49), { id, text }]);
    }
    agentOutput.on("event", handler);
    return () => { agentOutput.off("event", handler); };
  }, [agentOutput]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color="cyan">── Activity ──────────────────────────</Text>
      {items.map((item) => (
        <Text key={item.id}>{item.text}</Text>
      ))}
    </Box>
  );
}

function OperatorPane({ registry }: { registry: OperatorRegistry }) {
  const [operators, setOperators] = useState<OperatorContext[]>(() => registry.getActive());

  useEffect(() => {
    const sub = registry.onDidChange(() => setOperators(registry.getActive()));
    return () => sub.dispose();
  }, [registry]);

  const fg = registry.getForeground();

  return (
    <Box flexDirection="column" width={30} marginLeft={1}>
      <Text bold color="magenta">── Operators ──────</Text>
      {operators.map((op) => (
        <Box key={op.id} flexDirection="column">
          <Box>
            <Text color={op.id === fg?.id ? "green" : "gray"}>
              {op.id === fg?.id ? "● " : "○ "}
            </Text>
            {op.status === "active" ? <Spinner type="dots" /> : <Text> </Text>}
            <Text bold={op.id === fg?.id}> {op.name}</Text>
            {op.role ? <Text dimColor> {op.role}</Text> : null}
          </Box>
          <Text dimColor>
            {"  "}
            {op.status}
            {op.task ? `: ${op.task.slice(0, 20)}` : ""}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function StatusBar({ driveMode }: { driveMode: DriveModeManager }) {
  const [state, setState] = useState<DriveState>({
    active: driveMode.active,
    subMode: driveMode.subMode,
  });

  useEffect(() => {
    const listener = (s: DriveState) => setState(s);
    driveMode.on("change", listener);
    return () => driveMode.off("change", listener);
  }, [driveMode]);

  return (
    <Box marginTop={1}>
      <Text bold>Drive </Text>
      <Text color={state.active ? "green" : "gray"}>{state.active ? "● " : "○ "}</Text>
      <Text>{state.subMode}</Text>
    </Box>
  );
}

function App({ registry, driveMode, agentOutput }: TuiOptions) {
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.ctrl && input === "c") exit();
  });

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <ActivityPane agentOutput={agentOutput} />
        <OperatorPane registry={registry} />
      </Box>
      <StatusBar driveMode={driveMode} />
    </Box>
  );
}

export function startTui(opts: TuiOptions): void {
  render(<App {...opts} />);
}
