# Workspace Rules

## Terminal Execution

- On this machine, PowerShell inside the terminal sandbox fails and hangs on `Attempting to perform the InitializeDefaultDrives operation on the 'FileSystem' provider failed.`
- Always pass `BypassSandbox: true` when calling `run_command` in this workspace instead of trying sandboxed mode first.
