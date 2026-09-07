# Agent Island: observer only. Always exits successfully and writes no stdout.
param([Parameter(Mandatory=$true)][string]$Inbox)
$ErrorActionPreference = 'Stop'
try {
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    $hookInput = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($hookInput.agent_id -or $hookInput.agent_transcript_path) { exit 0 }
    $eventName = [string]$hookInput.hook_event_name
    if ($eventName -notin @('UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd', 'Notification', 'PostToolUse')) { exit 0 }
    $eventId = [Guid]::NewGuid().ToString('N')
    $eventTime = [DateTime]::UtcNow.ToString('o')
    $eventData = @{
        event_id = $eventId
        emitted_at = $eventTime
        hook_event_name = $eventName
        session_id = [string]$hookInput.session_id
        prompt_id = [string]$hookInput.prompt_id
        transcript_path = [string]$hookInput.transcript_path
        cwd = [string]$hookInput.cwd
        last_assistant_message = [string]$hookInput.last_assistant_message
        error = [string]$hookInput.error
        notification_type = [string]$hookInput.notification_type
        stop_hook_active = [bool]$hookInput.stop_hook_active
    }
    [System.IO.Directory]::CreateDirectory($Inbox) | Out-Null
    $eventFile = [System.IO.Path]::Combine($Inbox, ($eventId + '.json'))
    $eventJson = $eventData | ConvertTo-Json -Compress -Depth 5
    [System.IO.File]::WriteAllText(($eventFile + '.tmp'), $eventJson, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::Move(($eventFile + '.tmp'), $eventFile)
} catch { }
exit 0
