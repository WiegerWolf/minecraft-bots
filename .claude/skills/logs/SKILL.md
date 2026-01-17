---
name: logs
description: Analyze and search bot logs. Use for debugging bot behavior, finding errors, comparing sessions, filtering by level/component, or examining specific events.
allowed-tools: Read, Bash, Grep, Glob
---

# Bot Log Analysis Skill

Logs are stored in `logs/SESSION_ID/RoleLabel.log` as newline-delimited JSON (Pino format).

## Directory Structure

```
logs/
  2026-01-17_20-44-32/   # Session timestamp
    Farmer.log
    Lmbr.log
    Land.log
  latest -> ...          # Symlink to most recent session
```

## Log Format

Each line is a JSON object with these fields:
- `level`: 10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal
- `time`: ISO timestamp
- `msg`: Log message
- `botName`: Bot's Minecraft username (e.g., "Madonna_Lmbr")
- `role`: Role identifier (e.g., "goap-lumberjack")
- `component`: Optional component name (e.g., "Planner", "Executor")
- Additional context fields vary by log entry

## Common Commands

### List Sessions
```bash
# Recent sessions (newest first)
ls -t logs/ | grep -v latest | head -10

# Session with most logs
du -sh logs/*/ | sort -rh | head -5
```

### Latest Session Analysis
```bash
# All errors from last run
cat logs/latest/*.log | jq -c 'select(.level >= 50)'

# Warnings and errors
cat logs/latest/*.log | jq -c 'select(.level >= 40)'

# Info-level summary
cat logs/latest/*.log | jq -c 'select(.level == 30)' | head -50
```

### Search by Content
```bash
# Find specific message
grep -r "Goal selected" logs/latest/

# Find by component
cat logs/latest/*.log | jq -c 'select(.component == "Planner")'

# Find by goal name
cat logs/latest/*.log | jq -c 'select(.goal != null)'
```

### Filter by Role
```bash
# Farmer logs only
cat logs/latest/Farmer.log | jq -c 'select(.level >= 30)'

# Lumberjack errors
cat logs/latest/Lmbr.log | jq -c 'select(.level >= 50)'
```

### Time-based Analysis
```bash
# Logs from last N seconds of a session
cat logs/latest/*.log | jq -c --arg cutoff "$(date -d '60 seconds ago' -Iseconds)" 'select(.time > $cutoff)'

# Extract timestamps for timing analysis
cat logs/latest/*.log | jq -r '[.time, .msg] | @tsv'
```

### Aggregation and Counting
```bash
# Count by log level
cat logs/latest/*.log | jq -r '.level' | sort | uniq -c | sort -rn

# Count by component
cat logs/latest/*.log | jq -r '.component // "root"' | sort | uniq -c | sort -rn

# Count specific events
grep -c "Goal selected" logs/latest/*.log

# Message frequency
cat logs/latest/*.log | jq -r '.msg' | sort | uniq -c | sort -rn | head -20
```

### Compare Sessions
```bash
# Error count comparison
for d in $(ls -t logs/ | grep -v latest | head -3); do
  echo "$d: $(cat logs/$d/*.log 2>/dev/null | jq 'select(.level >= 50)' | wc -l) errors"
done

# Goal distribution across sessions
for d in $(ls -t logs/ | grep -v latest | head -3); do
  echo "=== $d ===" && cat logs/$d/*.log 2>/dev/null | jq -r 'select(.goal != null) | .goal' | sort | uniq -c
done
```

### Debug Specific Issues
```bash
# Pathfinding problems
cat logs/latest/*.log | jq -c 'select(.msg | test("path|stuck|unreachable"; "i"))'

# Planning failures
cat logs/latest/*.log | jq -c 'select(.component == "Planner" and .level >= 40)'

# Action execution
cat logs/latest/*.log | jq -c 'select(.action != null)'

# State changes
cat logs/latest/*.log | jq -c 'select(.msg | test("state|transition|change"; "i"))'
```

### Tail/Follow Logs
```bash
# Follow latest session
tail -f logs/latest/*.log

# Follow with jq formatting (requires unbuffer or stdbuf)
tail -f logs/latest/*.log | jq -c 'select(.level >= 30)'
```

## Analysis Workflow

1. **Start broad**: `cat logs/latest/*.log | jq -c 'select(.level >= 40)'` to find warnings/errors
2. **Narrow down**: Filter by component, role, or time range
3. **Get context**: Use `-B`/`-A` flags with grep to see surrounding lines
4. **Compare**: Check if issue exists in previous sessions
5. **Quantify**: Use counting/aggregation to measure frequency

## Key Log Patterns

| Pattern | Meaning |
|---------|---------|
| `"Goal selected"` | GOAP planner chose a new goal |
| `"Plan found"` | A* found valid action sequence |
| `"No plan found"` | Planning failed for current goal |
| `"Action completed"` | Single action in plan finished |
| `"Plan completed"` | All actions in plan finished |
| `"Replanning"` | World changed, need new plan |
| `level >= 50` | Errors requiring attention |
