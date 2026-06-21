# yt-server.ps1 — YT Downloader Backend (PowerShell, zero dependencias)
# Servidor HTTP local que usa yt-dlp.exe (standalone) para baixar videos.
# Nao precisa de Python, Node.js, nem nenhuma outra dependencia.
param([int]$Port = 5000)

$ErrorActionPreference = 'Continue'
$WorkDir = Join-Path $env:USERPROFILE '.yt-downloader-backend'
$YtDlp   = Join-Path $WorkDir 'yt-dlp.exe'
$FfDir   = Join-Path $WorkDir 'ffmpeg'
$DlBase  = Join-Path $env:TEMP 'YT_Downloader_3M\downloads'

if (!(Test-Path $YtDlp)) {
    Write-Host "`n  [ERRO] yt-dlp.exe nao encontrado em $WorkDir"
    Write-Host "  Execute o instalador .bat primeiro.`n"
    Read-Host 'Pressione Enter para sair'
    exit 1
}

# Desktop
$Desktop = @("$env:USERPROFILE\Desktop","$env:USERPROFILE\OneDrive\Desktop",$env:USERPROFILE) |
           Where-Object { Test-Path $_ } | Select-Object -First 1

# ffmpeg no PATH
if (Test-Path "$FfDir\ffmpeg.exe") { $env:PATH = "$FfDir;$env:PATH" }
$wl = "$env:LOCALAPPDATA\Microsoft\WinGet\Links"
if (Test-Path $wl) { $env:PATH = "$wl;$env:PATH" }
# WinGet package paths
Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg*" -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ChildItem $_.FullName -Recurse -Filter 'ffmpeg.exe' -ErrorAction SilentlyContinue } |
    Select-Object -First 1 | ForEach-Object { $env:PATH = "$($_.DirectoryName);$env:PATH" }

$HasFfmpeg = $null -ne (Get-Command ffmpeg -ErrorAction SilentlyContinue)
$Ver = '?'
try { $Ver = (& $YtDlp --version 2>$null).Trim() } catch {}

$script:Jobs = [hashtable]::Synchronized(@{})
$script:TrimData = @{}

function Cors($r) {
    $r.AddHeader('Access-Control-Allow-Origin','*')
    $r.AddHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS')
    $r.AddHeader('Access-Control-Allow-Headers','Content-Type')
}

function RespondJson($ctx, $obj, [int]$code = 200) {
    $j = $obj | ConvertTo-Json -Depth 10 -Compress
    $b = [Text.Encoding]::UTF8.GetBytes($j)
    $r = $ctx.Response; $r.StatusCode = $code
    $r.ContentType = 'application/json; charset=utf-8'
    Cors $r
    $r.ContentLength64 = $b.Length
    $r.OutputStream.Write($b, 0, $b.Length)
    $r.Close()
}

function ReadBody($ctx) {
    $sr = [IO.StreamReader]::new($ctx.Request.InputStream, $ctx.Request.ContentEncoding)
    $t = $sr.ReadToEnd(); $sr.Close()
    if ($t) { $t | ConvertFrom-Json } else { $null }
}

function ReadLogSafe($path) {
    if (!(Test-Path $path)) { return @() }
    try {
        $fs = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        $sr = [IO.StreamReader]::new($fs, [Text.Encoding]::UTF8)
        $text = $sr.ReadToEnd(); $sr.Close(); $fs.Close()
        return @($text -split "`r?`n" | Where-Object { $_ -ne '' })
    } catch { return @() }
}

# Banner
$host.UI.RawUI.WindowTitle = 'YT Downloader Backend'
Write-Host @"
==================================================
  YT Downloader Backend (PowerShell)
==================================================
  yt-dlp  : $Ver
  ffmpeg  : $(if($HasFfmpeg){'OK'}else{'NAO ENCONTRADO'})
  Porta   : $Port
==================================================
"@

# Cleanup old
if (Test-Path $DlBase) {
    Get-ChildItem $DlBase -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^[0-9a-f]{32}$' } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

$http = [Net.HttpListener]::new()
$http.Prefixes.Add("http://localhost:${Port}/")
try { $http.Start() } catch {
    Write-Host "`n  [ERRO] Porta $Port ja em uso. Feche o outro servidor.`n"
    Read-Host 'Pressione Enter para sair'; exit 1
}
Write-Host "`n  Servidor rodando em http://localhost:$Port"
Write-Host "  Volte ao GestaoOps - conecta automaticamente."
Write-Host "  Ctrl+C para parar.`n"

try {
while ($http.IsListening) {
    $ctx = $http.GetContext()
    $method = $ctx.Request.HttpMethod
    $path   = $ctx.Request.Url.AbsolutePath

    # CORS preflight
    if ($method -eq 'OPTIONS') {
        Cors $ctx.Response
        $ctx.Response.StatusCode = 204; $ctx.Response.Close(); continue
    }

    try {
        # ── GET / ──
        if ($path -eq '/') {
            RespondJson $ctx @{ status='ok'; ytdlp=$Ver; ffmpeg=$HasFfmpeg }
        }

        # ── POST /api/info ──
        elseif ($path -eq '/api/info' -and $method -eq 'POST') {
            $data = ReadBody $ctx
            $url = "$($data.url)".Trim()
            if (!$url) { RespondJson $ctx @{ error='Informe a URL.' } 400; continue }

            $argStr = "--dump-json --no-download --no-playlist --socket-timeout 30 --no-warnings"
            if ($HasFfmpeg) {
                $ffPath = (Get-Command ffmpeg).Source | Split-Path
                $argStr += " --ffmpeg-location `"$ffPath`""
            }
            $argStr += " `"$url`""

            Write-Host "  [?] Info: $url"
            $tmpOut = [IO.Path]::GetTempFileName()
            $tmpErr = [IO.Path]::GetTempFileName()
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = $YtDlp
            $psi.Arguments = $argStr
            $psi.UseShellExecute = $false
            $psi.RedirectStandardOutput = $true
            $psi.RedirectStandardError = $true
            $psi.CreateNoWindow = $true
            $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
            $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
            $proc = [Diagnostics.Process]::Start($psi)
            $stdout = $proc.StandardOutput.ReadToEnd()
            $stderr = $proc.StandardError.ReadToEnd()
            $proc.WaitForExit()
            $exitCode = $proc.ExitCode

            if ($exitCode -ne 0 -or !$stdout.Trim()) {
                $em = if ($stderr) { ($stderr -split "`n" | Where-Object { $_ -match 'ERROR' } | Select-Object -Last 1) } else { $null }
                if (!$em) { $em = "Erro ao buscar info (exit=$exitCode). Stderr: $stderr" }
                Write-Host "  [!] Info erro: $em"
                RespondJson $ctx @{ error="$em".Trim() } 400; continue
            }
            Write-Host "  [OK] Info recebido."

            $info = $stdout | ConvertFrom-Json
            $heights = @()
            if ($info.formats) {
                $heights = @($info.formats |
                    Where-Object { $_.height -gt 0 -and $_.vcodec -and $_.vcodec -ne 'none' } |
                    ForEach-Object { [int]$_.height } | Sort-Object -Unique -Descending)
            }

            RespondJson $ctx @{
                id              = $info.id
                title           = $info.title
                uploader        = if ($info.uploader) { $info.uploader } else { $info.channel }
                duration        = $info.duration
                duration_string = $info.duration_string
                thumbnail       = $info.thumbnail
                is_live         = [bool]$info.is_live
                availability    = "$($info.availability)"
                heights         = $heights
            }
        }

        # ── POST /api/download ──
        elseif ($path -eq '/api/download' -and $method -eq 'POST') {
            $data = ReadBody $ctx
            $url = "$($data.url)".Trim()
            if (!$url) { RespondJson $ctx @{ error='Informe a URL.' } 400; continue }

            $fmt     = if ($data.format)        { "$($data.format)" }        else { 'mp4' }
            $quality = if ($data.quality)        { "$($data.quality)" }       else { 'best' }
            $audioQ  = if ($data.audio_quality)  { "$($data.audio_quality)" } else { '192' }
            $dp      = if ($data.dest_path)      { "$($data.dest_path)".Trim() } else { '' }
            $dest    = if ($dp) { $dp } else { $Desktop }

            if (($fmt -eq 'mp3' -or $data.start_time -or $data.end_time) -and !$HasFfmpeg) {
                RespondJson $ctx @{ error='ffmpeg necessario para MP3/corte. Instale: winget install Gyan.FFmpeg' } 400; continue
            }

            $jid = [guid]::NewGuid().ToString('N')
            $outDir = Join-Path $DlBase $jid
            New-Item -ItemType Directory -Path $outDir -Force | Out-Null

            $oTemplate = Join-Path $outDir '%(title).180B.%(ext)s'
            $argStr = "--newline --no-playlist --socket-timeout 30 --retries 5 --fragment-retries 5 --concurrent-fragments 4 --windows-filenames -o `"$oTemplate`""
            if ($HasFfmpeg) {
                $ffPath = (Get-Command ffmpeg).Source | Split-Path
                $argStr += " --ffmpeg-location `"$ffPath`""
            }
            if ($fmt -eq 'mp3') {
                $argStr += " -f bestaudio/best -x --audio-format mp3 --audio-quality $audioQ"
            } else {
                if ($quality -and $quality -ne 'best') {
                    $h = $quality -replace 'p',''
                    $argStr += " -f `"bestvideo[height<=$h][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=$h]+bestaudio/best[height<=$h]/best`""
                } else {
                    $argStr += ' -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best"'
                }
                $argStr += ' --merge-output-format mp4'
            }
            $script:TrimData[$jid] = $null
            if ($data.start_time -or $data.end_time) {
                $s = if ($data.start_time) { "$($data.start_time)" } else { '0' }
                $e = if ($data.end_time)   { "$($data.end_time)" }   else { '' }
                $script:TrimData[$jid] = @{ start=$s; end=$e }
            }
            $argStr += " `"$url`""

            $stdLog = Join-Path $outDir 'stdout.log'
            $errLog = Join-Path $outDir 'stderr.log'

            # Use cmd /c to redirect output to files in real-time (Start-Process buffers)
            $cmdArgs = "/c `"`"$YtDlp`" $argStr > `"$stdLog`" 2> `"$errLog`"`""
            $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdArgs -WindowStyle Hidden -PassThru

            $script:Jobs[$jid] = @{
                proc      = $proc
                outDir    = $outDir
                stdLog    = $stdLog
                errLog    = $errLog
                dest      = $dest
                format    = $fmt
                finished  = $false
                filename  = $null
                filepath  = $null
                filesize  = $null
                error     = $null
                warning   = $null
            }

            Write-Host "  [+] Job $jid iniciado: $url"
            RespondJson $ctx @{ job_id = $jid }
        }

        # ── GET /api/progress/<jid> ──
        elseif ($path -match '^/api/progress/([0-9a-f]{32})$') {
            $jid = $Matches[1]
            $job = $script:Jobs[$jid]
            if (!$job) { RespondJson $ctx @{ error='Job nao encontrado.' } 404; continue }

            $outLines = ReadLogSafe $job.stdLog
            $errLines = ReadLogSafe $job.errLog
            $allLines = @('Destino: ' + $job.dest) + $outLines + @($errLines | Where-Object { $_ -notmatch '^\s*$' -and $_ -notmatch '^\[debug\]' })

            # Parse progress
            $status = 'extracting'; $pct = 0
            foreach ($ln in $allLines) {
                if ($ln -match '\[download\]\s+([\d.]+)%') {
                    $status = 'downloading'; $pct = [math]::Round([double]$Matches[1], 1)
                }
                elseif ($ln -match '\[download\]\s*100') { $status = 'processing'; $pct = 100 }
                elseif ($ln -match '\[(Merger|ffmpeg|ExtractAudio|FixupM3u8)\]') { $status = 'processing'; $pct = 100 }
                elseif ($ln -match 'Duration:|Stream #|frame=|size=|time=') { $status = 'processing'; $pct = 95 }
                elseif ($ln -match '\[download\] Destination:') { if ($status -eq 'extracting') { $status = 'downloading'; $pct = 1 } }
            }

            # Check process
            $procDone = $false
            try { $procDone = $job.proc.HasExited } catch { $procDone = $true }

            if ($procDone -and !$job.finished) {
                $media = @(Get-ChildItem $job.outDir -File -ErrorAction SilentlyContinue |
                           Where-Object { $_.Extension -notin '.part','.ytdl','.log','.tmp' })
                if ($media.Count -gt 0) {
                    $ext = if ($job.format -eq 'mp3') { '.mp3' } else { '.mp4' }
                    $pick = $media | Where-Object { $_.Extension -eq $ext } | Sort-Object Length -Descending | Select-Object -First 1
                    if (!$pick) { $pick = $media | Sort-Object Length -Descending | Select-Object -First 1 }

                    # Trim with ffmpeg if needed
                    $trim = $script:TrimData[$jid]
                    if ($trim -and $HasFfmpeg) {
                        Write-Host "  [~] Cortando trecho: $($trim.start) - $($trim.end)"
                        $trimOut = Join-Path $job.outDir ("trimmed" + $pick.Extension)
                        $ffArgs = "-y -i `"$($pick.FullName)`" -ss $($trim.start)"
                        if ($trim.end) { $ffArgs += " -to $($trim.end)" }
                        $ffArgs += " -c copy `"$trimOut`""
                        $ffProc = Start-Process -FilePath 'ffmpeg' -ArgumentList $ffArgs -WindowStyle Hidden -Wait -PassThru
                        if ($ffProc.ExitCode -eq 0 -and (Test-Path $trimOut)) {
                            Remove-Item $pick.FullName -Force -ErrorAction SilentlyContinue
                            Rename-Item $trimOut $pick.Name -ErrorAction SilentlyContinue
                            $pick = Get-Item (Join-Path $job.outDir $pick.Name)
                            Write-Host "  [OK] Trecho cortado."
                        } else {
                            $job.warning = "Corte falhou, usando arquivo completo."
                            Write-Host "  [!] Corte falhou."
                        }
                    }

                    try {
                        if (!(Test-Path $job.dest)) { New-Item -ItemType Directory -Path $job.dest -Force | Out-Null }
                        $target = Join-Path $job.dest $pick.Name
                        $i = 1
                        while (Test-Path $target) {
                            $target = Join-Path $job.dest ($pick.BaseName + " ($i)" + $pick.Extension)
                            $i++
                        }
                        Move-Item $pick.FullName $target -Force
                        $job.filepath = $target
                        $job.filename = [IO.Path]::GetFileName($target)
                        $job.filesize = (Get-Item $target).Length
                    } catch {
                        $job.filepath = $pick.FullName
                        $job.filename = $pick.Name
                        $job.filesize = $pick.Length
                        $job.warning  = "Nao moveu para destino: $_"
                    }
                    $status = 'done'; $pct = 100
                } else {
                    $errText = ($errLines | Where-Object { $_ -match 'ERROR' }) -join ' '
                    if (!$errText) { $errText = 'Download falhou.' }
                    $job.error = $errText.Trim()
                    $status = 'error'
                }
                $job.finished = $true
                Write-Host "  [=] Job $jid $status"
            }

            if ($job.finished) {
                if ($job.error) { $status = 'error' }
                elseif ($job.filepath) {
                    $status = 'done'; $pct = 100
                    if ($allLines[-1] -notmatch 'Salvo') { $allLines += "Salvo em: $($job.filepath)" }
                }
            }

            RespondJson $ctx @{
                status    = $status
                progress  = $pct
                speed     = $null
                eta       = $null
                title     = $null
                filename  = $job.filename
                filepath  = $job.filepath
                filesize  = $job.filesize
                error     = $job.error
                warning   = $job.warning
                log       = if ($allLines.Count) { $allLines[-1] } else { '' }
                log_lines = $allLines
            }
        }

        # ── GET /api/file/<jid> ──
        elseif ($path -match '^/api/file/([0-9a-f]{32})$') {
            $jid = $Matches[1]
            $job = $script:Jobs[$jid]
            if (!$job -or !$job.filepath -or !(Test-Path $job.filepath)) {
                RespondJson $ctx @{ error='Arquivo indisponivel.' } 404; continue
            }
            $r = $ctx.Response; $r.StatusCode = 200
            $r.ContentType = 'application/octet-stream'
            Cors $r
            $r.AddHeader('Content-Disposition', "attachment; filename=`"$($job.filename)`"")
            $fs = [IO.File]::OpenRead($job.filepath)
            $r.ContentLength64 = $fs.Length
            $buf = New-Object byte[] 65536
            while (($n = $fs.Read($buf, 0, $buf.Length)) -gt 0) { $r.OutputStream.Write($buf, 0, $n) }
            $fs.Close(); $r.Close()
        }

        # ── GET /api/open-folder/<jid> ──
        elseif ($path -match '^/api/open-folder/([0-9a-f]{32})$') {
            $jid = $Matches[1]
            $job = $script:Jobs[$jid]
            if ($job -and $job.filepath -and (Test-Path $job.filepath)) {
                Start-Process explorer.exe -ArgumentList "/select,`"$($job.filepath)`""
            }
            RespondJson $ctx @{ ok=$true }
        }

        # ── 404 ──
        else { RespondJson $ctx @{ error='Not found' } 404 }

    } catch {
        Write-Host "  [!] Erro: $_"
        try { RespondJson $ctx @{ error="Erro interno: $_" } 500 } catch {}
    }
}
} finally {
    $http.Stop()
    Write-Host "`n  Servidor encerrado."
}
