# /drive — Bootstrap and connect to claude-drive

Run the boot script to ensure claude-drive is running, then confirm the MCP tools are available.

## Steps

1. Run `node scripts/boot.mjs` from the project root to bootstrap the environment:
   - Installs dependencies if missing
   - Ensures `.env` has `ANTHROPIC_API_KEY`
   - Compiles TypeScript if source is newer than output
   - Starts the MCP server if not already running
   - Registers with `~/.claude/settings.json`

2. After boot completes, verify the server is healthy by checking `http://localhost:7891/health`

3. Report the status:
   - Server URL (MCP endpoint)
   - Dashboard URL
   - Number of active operators
   - Whether API key is available

4. If the user provided arguments after `/drive`, treat them as a task:
   - Use the `drive_run_task` MCP tool to dispatch it to an operator

## Usage

```
/drive                    # Just boot and show status
/drive fix the auth bug   # Boot and dispatch a task
```
