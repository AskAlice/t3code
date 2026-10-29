# Managed policy

A managed policy lets an administrator configure T3 Code for every user on a machine. Deploy one
file with your usual device management tool (Jamf, Kandji, Intune, Ansible). The T3 Code server
on that machine follows it, whichever app connects: desktop, the browser, or mobile.

## Where the file goes

| OS      | Path                                              |
| ------- | ------------------------------------------------- |
| macOS   | `/Library/Application Support/T3Code/policy.json` |
| Linux   | `/etc/t3code/policy.json`                         |
| Windows | `C:\ProgramData\T3Code\policy.json`               |

Make the file writable only by administrators. T3 Code reads it when the server starts, so restart
the app after you deploy or change it. Without the file, every setting belongs to the user.

## Settings

```json
{
  "schemaVersion": 1,
  "organization": "Example Corp",
  "supportUrl": "https://it.example.com/t3",
  "settings": {
    "defaultRuntimeMode": { "value": "approval-required", "locked": false },
    "enableAgentBrowserAccess": { "value": false, "locked": true },
    "storageCleanup.logsAfterDays": { "value": 30, "locked": true }
  }
}
```

Each key under `settings` names a server setting by its path in the server's `settings.json`.

- `"locked": false` sets the default. Users start there and can change it.
- `"locked": true` sets the value and stops users and agents from changing it, including in
  per-project settings. Settings shows the control as **Managed by** your organization.

T3 Code never writes policy values into the user's own settings. If you remove the file, users get
back the settings they had chosen.

## Check a policy

Run `t3 policy check <file>` to validate a draft before you deploy it. Run `t3 policy show` on a
machine to see the policy that applies there.

T3 Code refuses to start with a policy it cannot fully apply: a file that is not valid JSON, a
setting it does not know, a value of the wrong type, or a key that this version does not support.
A policy written for a newer version can carry keys an older one cannot enforce, so upgrade
T3 Code before you deploy the policy that uses them.

## What a policy does not cover

The policy controls what T3 Code does. Agents still run through each provider's own CLI, which a
user can also run outside T3 Code. To restrict those CLIs, use their own managed configuration, such
as Claude Code's managed settings. A user with administrator rights on the machine can edit or
remove the policy file.
