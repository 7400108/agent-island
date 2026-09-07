param([string]$Inbox)
try {
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    $hookData = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $shape = @{
        name = [string]$hookData.hook_event_name
        keys = @($hookData.PSObject.Properties.Name)
        hasAgentId = [bool]$hookData.agent_id
        hasAgentTranscript = [bool]$hookData.agent_transcript_path
        answerLength = ([string]$hookData.last_assistant_message).Length
        stopHookActive = [bool]$hookData.stop_hook_active
    }
    [System.IO.Directory]::CreateDirectory($Inbox) | Out-Null
    [System.IO.File]::WriteAllText([System.IO.Path]::Combine($Inbox, ([Guid]::NewGuid().ToString('N') + '.shape')), ($shape | ConvertTo-Json -Compress -Depth 4))
} catch {}
exit 0
