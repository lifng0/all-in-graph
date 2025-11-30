param(
  [int]$Port = 8090,
  [string]$Root = "web"
)

# Try to ensure HttpListener is available, ignore failures on Core editions
try { Add-Type -AssemblyName System.Net.HttpListener } catch {}
$prefix = "http://localhost:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "[server] Listening at $prefix root=$Root"

function Get-ContentType($path){
  switch([System.IO.Path]::GetExtension($path).ToLower()){
    ".html" { return "text/html" }
    ".css" { return "text/css" }
    ".js" { return "application/javascript" }
    default { return "text/plain" }
  }
}

$Global:Sessions = [hashtable]::Synchronized(@{})
$Global:Tokens = [hashtable]::Synchronized(@{})
$Global:Metrics = [hashtable]::Synchronized(@{requests=0; chat_calls=0; stream_calls=0; undo_calls=0; redo_calls=0; errors=0})
$Global:Features = [hashtable]::Synchronized(@{EnableNewOps=$true; UseSSE=$true; RateLimitPerMin=120; QuotaPerDay=5000; SessionTtlMinutes=30; HistoryLimit=100})

function Now(){ [DateTime]::UtcNow }

function EnsureSession($sessionId){
  if([string]::IsNullOrWhiteSpace($sessionId)){ return $null }
  $s = $Global:Sessions[$sessionId]
  if(-not $s){
    $s = @{ canvases=@{}; undo=@(); redo=@(); last=Now; rate=@{winStart=Now; count=0}; quota=@{day=(Now).Date; used=0} }
    $Global:Sessions[$sessionId] = $s
  }
  $s.last = Now
  return $s
}

function GetCanvas($s, $id){
  if([string]::IsNullOrWhiteSpace($id)){ $id = 'main' }
  $c = $s.canvases[$id]
  if(-not $c){ $s.canvases[$id] = @{ nodes=@(); edges=@() }; $c = $s.canvases[$id] }
  return $c
}

function PushUndo($s){
  $snap = @{ canvases = $s.canvases } | ConvertTo-Json -Depth 12
  $s.undo = ,$snap + $s.undo
  if($s.undo.Count -gt $Global:Features.HistoryLimit){ $s.undo = $s.undo[0..($Global:Features.HistoryLimit-1)] }
  $s.redo = @()
}

function ApplyOpsToSession($s, $payload, $ops){
  $active = if($payload.activeCanvasId){ $payload.activeCanvasId } else { 'main' }
  foreach($op in $ops){
    $targetId = if($op.targetCanvas){ $op.targetCanvas } else { $active }
    $canvas = GetCanvas $s $targetId
    if($op.type -eq 'create_child_canvas'){
      $cid = $op.canvasId
      if(-not $s.canvases[$cid]){ $s.canvases[$cid] = @{ nodes=@(); edges=@() } }
      continue
    }
    if($op.type -eq 'add_nodes'){
      foreach($n in $op.nodes){
        $id = if($n.id){ $n.id } else { 'u' + [Random]::new().Next(100000,999999) }
        $canvas.nodes += @{ id=$id; label=(if($n.label){$n.label}else{$id}); name=$n.name; summary=$n.summary; x=(if($n.x){$n.x}else{0}); y=(if($n.y){$n.y}else{0}); w=$n.w; h=$n.h }
      }
      continue
    }
    if($op.type -eq 'add_edges'){
      foreach($e in $op.edges){
        $eid = if($e.id){ $e.id } else { 'e' + [Random]::new().Next(100000,999999) }
        $canvas.edges += @{ id=$eid; source=$e.source; target=$e.target; name=$e.name; summary=$e.summary }
      }
      continue
    }
    if($op.type -eq 'update_node'){
      $node = ($canvas.nodes | Where-Object { $_.id -eq $op.id } | Select-Object -First 1)
      if($node){ if($op.label){ $node.label = $op.label }; if($op.name){ $node.name = $op.name }; if($op.summary){ $node.summary = $op.summary }; if($op.x){ $node.x = $op.x }; if($op.y){ $node.y = $op.y }; if($op.w){ $node.w = $op.w }; if($op.h){ $node.h = $op.h } }
      continue
    }
    if($op.type -eq 'update_edge'){
      $edge = ($canvas.edges | Where-Object { $_.id -eq $op.id } | Select-Object -First 1)
      if($edge){ if($op.name){ $edge.name = $op.name }; if($op.summary){ $edge.summary = $op.summary } }
      continue
    }
    if($op.type -eq 'delete_nodes'){
      $ids = @($op.ids)
      $canvas.nodes = @($canvas.nodes | Where-Object { $ids -notcontains $_.id })
      $canvas.edges = @($canvas.edges | Where-Object { ($ids -notcontains $_.source) -and ($ids -notcontains $_.target) })
      continue
    }
    if($op.type -eq 'delete_edges'){
      $ids = @($op.ids)
      $canvas.edges = @($canvas.edges | Where-Object { $ids -notcontains $_.id })
      continue
    }
    if($op.type -eq 'group_nodes'){
      continue
    }
    if($op.type -eq 'ungroup_nodes'){
      continue
    }
    if($op.type -eq 'fold_node'){
      continue
    }
    if($op.type -eq 'unfold_node'){
      continue
    }
    if($op.type -eq 'extract_subgraph'){
      $cid = if($op.canvasId){ $op.canvasId } else { 'sub-' + [Random]::new().Next(100000,999999) }
      $nodes = @($canvas.nodes | Where-Object { $op.ids -contains $_.id })
      $edges = @($canvas.edges | Where-Object { ($op.ids -contains $_.source) -and ($op.ids -contains $_.target) })
      $s.canvases[$cid] = @{ nodes=$nodes; edges=$edges }
      continue
    }
    if($op.type -eq 'relayout'){
      RelayoutCanvas $canvas
      continue
    }
    if($op.type -eq 'annotate'){
      foreach($a in $op.items){
        $node = ($canvas.nodes | Where-Object { $_.id -eq $a.id } | Select-Object -First 1)
        if($node){ $node.summary = $a.summary }
      }
      continue
    }
  }
}

function DecideLayoutParams($canvas){
  $n = $canvas.nodes.Count
  $spacingX = if($n -gt 40){ 240 } elseif($n -gt 20){ 280 } else { 320 }
  $spacingY = if($n -gt 40){ 120 } elseif($n -gt 20){ 160 } else { 200 }
  return @{ sx=$spacingX; sy=$spacingY }
}

function RelayoutCanvas($canvas){
  $p = DecideLayoutParams $canvas
  $deg = @{}
  foreach($n in $canvas.nodes){ $deg[$n.id] = 0 }
  foreach($e in $canvas.edges){ if($deg.ContainsKey($e.source)){ $deg[$e.source] = $deg[$e.source] + 1 }; if($deg.ContainsKey($e.target)){ $deg[$e.target] = $deg[$e.target] + 1 } }
  $root = ($deg.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 1).Key
  if(-not $root){ if($canvas.nodes.Count -gt 0){ $root = $canvas.nodes[0].id } }
  $level = @{}
  foreach($n in $canvas.nodes){ $level[$n.id] = 0 }
  $visited = [hashtable]::Synchronized(@{})
  $queue = New-Object System.Collections.Queue
  if($root){ $queue.Enqueue($root); $visited[$root] = $true }
  while($queue.Count -gt 0){
    $cur = $queue.Dequeue()
    foreach($e in $canvas.edges){
      if($e.source -eq $cur){ if(-not $visited[$e.target]){ $level[$e.target] = [Math]::Max($level[$e.target], $level[$cur] + 1); $queue.Enqueue($e.target); $visited[$e.target] = $true } }
      if($e.target -eq $cur){ if(-not $visited[$e.source]){ $level[$e.source] = [Math]::Max($level[$e.source], $level[$cur] + 1); $queue.Enqueue($e.source); $visited[$e.source] = $true } }
    }
  }
  $groups = @{}
  foreach($n in $canvas.nodes){ $lv = if($level[$n.id]){ $level[$n.id] } else { 0 }; if(-not $groups.ContainsKey($lv)){ $groups[$lv] = New-Object System.Collections.Generic.List[object] }; $groups[$lv].Add($n) }
  $x0 = 80; $y0 = 80
  $lvls = ($groups.Keys | Sort-Object)
  $xi = 0
  foreach($lv in $lvls){
    $nodesAt = $groups[$lv]
    $yi = 0
    foreach($n in $nodesAt){ $n.x = $x0 + ($xi * $p.sx); $n.y = $y0 + ($yi * $p.sy) + ([Random]::new().Next(-12,12)); $yi += 1 }
    $xi += 1
  }
}

function ValidateToken($req){
  $auth = $req.Headers['Authorization']
  if([string]::IsNullOrWhiteSpace($auth)){ return $null }
  if(-not $auth.StartsWith('Bearer ')){ return $null }
  $token = $auth.Substring(7)
  $t = $Global:Tokens[$token]
  if($t -and ($t.exp -gt (Now))){ return $token }
  return $null
}

function IssueToken($clientId, $clientSecret){
  if([string]::IsNullOrWhiteSpace($clientId) -or [string]::IsNullOrWhiteSpace($clientSecret)){ return $null }
  $token = [Guid]::NewGuid().ToString()
  $Global:Tokens[$token] = @{ exp = (Now).AddHours(1); cid=$clientId }
  return $token
}

function CheckRate($s){
  $now = Now
  if((New-TimeSpan -Start $s.rate.winStart -End $now).TotalMinutes -ge 1){ $s.rate.winStart = $now; $s.rate.count = 0 }
  if($s.rate.count -ge $Global:Features.RateLimitPerMin){ throw 'rate_limit' }
  $s.rate.count = $s.rate.count + 1
  if($s.quota.day -ne $now.Date){ $s.quota.day = $now.Date; $s.quota.used = 0 }
  if($s.quota.used -ge $Global:Features.QuotaPerDay){ throw 'quota_exceeded' }
  $s.quota.used = $s.quota.used + 1
}

function ExpireSessions(){
  $now = Now
  foreach($k in @($Global:Sessions.Keys)){
    $s = $Global:Sessions[$k]
    if((New-TimeSpan -Start $s.last -End $now).TotalMinutes -ge $Global:Features.SessionTtlMinutes){ [void]$Global:Sessions.Remove($k) }
  }
  foreach($tk in @($Global:Tokens.Keys)){
    $t = $Global:Tokens[$tk]
    if($t.exp -le $now){ [void]$Global:Tokens.Remove($tk) }
  }
}

function CallAIModel($payload){
  $endpoint = if([string]::IsNullOrWhiteSpace($env:AI_ENDPOINT)) { 'https://api.deepseek.com/v1/chat/completions' } else { $env:AI_ENDPOINT }
  $model = if([string]::IsNullOrWhiteSpace($env:AI_MODEL)) { 'deepseek-chat' } else { $env:AI_MODEL }
  $token = $env:AI_TOKEN
  if([string]::IsNullOrWhiteSpace($token)){ throw 'no_token' }
  $sys = "你是一个图形编排AI。输出严格的 JSON：{\"reply\": \"高质量中文对话\", \"ops\": [GraphOps...]}" +
         "`n约束：文本对话权重70%，图形操作权重30%；在明确理解意图后再执行图操作；按需创建，不得提前生成无关节点。" +
         "`n指令集：add_nodes, add_edges, update_node, update_edge, create_child_canvas, delete_nodes, delete_edges。节点需包含 name 与 summary。" +
         "`nDeepSeek节点规则：初次仅创建主节点(ds-root)；能力/API/限速等子节点需在选中主节点且用户明确询问后再创建。" +
         "`n删除规范：能够识别并执行元素删除指令（全局/点名/选区），并在 reply 中解释所做变更。" +
         "`n不确定时在 reply 中主动澄清；只输出 JSON，无多余文本或代码块。"
  # 压缩图上下文，避免过长
  $g = $payload.graph
  $nodes = @()
  $edges = @()
  if($g){
    $nodes = @($g.nodes)
    if($nodes.Count -gt 50){ $nodes = $nodes[0..49] }
    $edges = @($g.edges)
    if($edges.Count -gt 80){ $edges = $edges[0..79] }
  }
  $sel = $payload.selection
  $context = @{ activeCanvasId = $payload.activeCanvasId; selection = $sel; nodes = $nodes; edges = $edges }
  $messages = @(
    @{ role='system'; content=$sys },
    @{ role='user'; content = ("User: " + ($payload.message) + "`nContext: " + ((ConvertTo-Json $context -Depth 6))) }
  )
  $body = @{ model=$model; messages=$messages; temperature=0; stream=$false } | ConvertTo-Json -Depth 8
  $headers = @{ 'Content-Type'='application/json'; 'Authorization'=('Bearer ' + $token) }
  $attempts = 0; $max = 3; $last = $null
  while($attempts -lt $max){
    try {
      $res = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -Body $body -TimeoutSec 20
      $content = $res.choices[0].message.content
      # 解析为JSON
      try {
        $parsed = $content | ConvertFrom-Json
        return @{ reply = $parsed.reply; ops = $parsed.ops }
      } catch {
        # 尝试提取花括号JSON
        $m = [System.Text.RegularExpressions.Regex]::Match($content, "\{[\s\S]*\}")
        if($m.Success){
          $parsed2 = $m.Value | ConvertFrom-Json
          return @{ reply = $parsed2.reply; ops = $parsed2.ops }
        }
        throw 'parse_failed'
      }
    } catch { $last = $_; Start-Sleep -Milliseconds (250 * ($attempts + 1)); $attempts = $attempts + 1 }
  }
  throw $last
}

function GetNeighbors($graph, $nodeId){
  $ids = New-Object System.Collections.Generic.List[string]
  foreach($e in $graph.edges){ if($e.source -eq $nodeId){ $ids.Add($e.target) } elseif($e.target -eq $nodeId){ $ids.Add($e.source) } }
  return $ids
}

function ChooseCanvasStrategy($payload){
  $g = $payload.graph
  $selId = $null
  try { if($payload.selection.nodes.Count -gt 0){ $selId = $payload.selection.nodes[0] } } catch {}
  $neighbors = @()
  if($selId){ $neighbors = GetNeighbors $g $selId }
  $dense = ($g.nodes.Count -ge 12) -or ($neighbors.Count -ge 5)
  $selectedNode = $null
  try { $selectedNode = ($g.nodes | Where-Object { $_.id -eq $selId } | Select-Object -First 1) } catch {}
  $selectedLabel = if($selectedNode){ $selectedNode.label } else { '' }
  $related = ($payload.message -match '(CPU|central processing unit|processor)') -and $selId -and ($selectedLabel -match '(CPU|中央处理器)')
  if($dense -or ((-not $related) -and $selId)){ return @{ mode = 'child'; nodeId = $selId } }
  return @{ mode = 'main' }
}

function BuildOps($payload){
  $ops = @()
  $selId = $null
  try { if($payload.selection.nodes.Count -gt 0){ $selId = $payload.selection.nodes[0] } } catch {}
  $strategy = ChooseCanvasStrategy $payload
  $msg = if($payload.message){ [string]$payload.message } else { '' }
  $lower = $msg.ToLowerInvariant()
  # 通用删除
  if(($lower -match '删除') -and ($lower -match '所有|全部|全部内容|图中|画布')){
    $idsN = @(); $idsE = @()
    try { foreach($n in $payload.graph.nodes){ $idsN += $n.id } } catch {}
    try { foreach($e in $payload.graph.edges){ $idsE += $e.id } } catch {}
    if($idsN.Count -gt 0){ $ops += @{ type='delete_nodes'; ids=$idsN } }
    if($idsE.Count -gt 0){ $ops += @{ type='delete_edges'; ids=$idsE } }
  } elseif($lower -match '删除'){
    $names = ParseTargets $msg
    $ids = @()
    try { if($payload.selection.nodes.Count -gt 0){ foreach($id in $payload.selection.nodes){ $ids += $id } } } catch {}
    if($ids.Count -eq 0 -and $names.Count -gt 0){
      try { foreach($n in $payload.graph.nodes){ foreach($nm in $names){ if(($n.id -eq $nm) -or (($n.label) -like ('*'+$nm+'*'))){ $ids += $n.id } } } } catch {}
    }
    if($ids.Count -gt 0){ $ops += @{ type='delete_nodes'; ids=$ids } }
  }
  # 通用添加
  if($lower -match '添加|新增|创建'){
    $anchor = if($selId){ $selId } else { if($payload.graph.nodes.Count -gt 0){ $payload.graph.nodes[0].id } else { 'n1' } }
    $names = ParseTargets $msg
    if($names.Count -eq 0){ $names = @('新节点') }
    $nodes = @()
    $i = 0
    foreach($nm in $names){ $nodes += @{ id=('add-'+[Guid]::NewGuid().ToString().Substring(0,8)+'-'+$i); label=$nm; name=$nm; summary=('用户请求添加的元素：'+$nm) }; $i += 1 }
    $ops += @{ type='add_nodes'; attachTo=$anchor; nodes=$nodes }
  }
  if(($lower.Contains('删除')) -and ($lower.Contains('你自己') -or $lower.Contains('deepseek') -or $lower.Contains('自我'))){
    $allNodeIds = @()
    $allEdgeIds = @()
    try { foreach($n in $payload.graph.nodes){ $allNodeIds += $n.id } } catch {}
    try { foreach($e in $payload.graph.edges){ $allEdgeIds += $e.id } } catch {}
    if($allNodeIds.Count -gt 0){ $ops += @{ type='delete_nodes'; ids=$allNodeIds } }
    if($allEdgeIds.Count -gt 0){ $ops += @{ type='delete_edges'; ids=$allEdgeIds } }
    $ops += @{ type='add_nodes'; nodes=@(@{id='ds-root'; label='DeepSeek 大模型'; name='DeepSeek'; summary='通用对话与图编排能力'}) }
  }
  # DeepSeek 子节点仅在选中主节点并明确询问时创建
  if(($lower -match 'deepseek') -or ($lower -match '你自己') -or ($lower -match '自我')){
    $detail = ($lower -match '能力|api|接口|限速|安全|上下文|window|tools')
    if($detail -and $selId -eq 'ds-root'){
      $ops += @{ type='add_nodes'; attachTo='ds-root'; nodes=@(
        @{id='ds-cap'; label='模型能力'; name='能力'; summary='推理、生成、多轮对话'},
        @{id='ds-api'; label='API'; name='API'; summary='REST/SSE流式输出'},
        @{id='ds-rate'; label='速率限制'; name='限速'; summary='QPS与配额管理'},
        @{id='ds-safety'; label='安全与合规'; name='安全'; summary='鉴权与审计'},
        @{id='ds-context'; label='上下文窗口'; name='上下文'; summary='长上下文与工具调用'}
      ) }
      $ops += @{ type='add_edges'; edges=@(
        @{id='e-ds-cap'; source='ds-root'; target='ds-cap'; name='包含'; summary='DeepSeek 包含核心能力'},
        @{id='e-ds-api'; source='ds-root'; target='ds-api'; name='提供'; summary='提供标准API'},
        @{id='e-ds-rate'; source='ds-root'; target='ds-rate'; name='策略'; summary='配额与限速策略'},
        @{id='e-ds-safety'; source='ds-root'; target='ds-safety'; name='保障'; summary='安全与合规'},
        @{id='e-ds-context'; source='ds-root'; target='ds-context'; name='特性'; summary='上下文与工具集成'}
      ) }
    }
  }
  if($lower.Contains('computer')){
    $rootId = if($selId){ $selId } else { 'n1' }
    $ops += @{ type = 'add_nodes'; attachTo = $rootId; nodes = @(
      @{ id='mem'; label='Memory'; name='Memory'; summary='Stores data and instructions temporarily.' },
      @{ id='storage'; label='Storage'; name='Storage'; summary='Persists data long-term.' },
      @{ id='io-in'; label='Input Device'; name='Input Device'; summary='Keyboard, mouse, etc.' },
      @{ id='io-out'; label='Output Device'; name='Output Device'; summary='Display, printer, etc.' }
    ) }
    $ops += @{ type = 'add_edges'; edges = @(
      @{ id='e-mem'; source=$rootId; target='mem'; name='Includes'; summary='Computer includes memory.' },
      @{ id='e-sto'; source=$rootId; target='storage'; name='Includes'; summary='Computer includes storage.' },
      @{ id='e-ioi'; source=$rootId; target='io-in'; name='Interacts'; summary='Inputs to computer.' },
      @{ id='e-ioo'; source=$rootId; target='io-out'; name='Interacts'; summary='Computer outputs to environment.' }
    ) }
  }
  if($lower.Contains('cpu')){
    if($strategy.mode -eq 'child' -and $selId){
      $childId = 'c-' + $selId
      $baseLabel = (((($payload.graph.nodes | Where-Object { $_.id -eq $selId }) | Select-Object -First 1).label))
      $title = ($baseLabel + ' - details')
      $ops += @{ type='create_child_canvas'; nodeId=$selId; canvasId=$childId; title=$title }
      $ops += @{ type='add_nodes'; targetCanvas=$childId; nodes=@(
        @{ id=($selId+'-core'); label='Core'; name='Core'; summary='Executes instructions and controls operations.'; x=300; y=200 },
        @{ id=($selId+'-cache'); label='Cache'; name='Cache'; summary='Speeds up data access.'; x=520; y=200 },
        @{ id=($selId+'-alu'); label='ALU'; name='ALU'; summary='Performs arithmetic and logic.'; x=300; y=320 }
      ); edges=@() }
      $ops += @{ type='add_edges'; edges=@(
        @{ id=('e-'+$selId+'-core-alu'); source=($selId+'-core'); target=($selId+'-alu'); name='Executes'; summary='Core drives ALU for computation.' },
        @{ id=('e-'+$selId+'-core-cache'); source=($selId+'-core'); target=($selId+'-cache'); name='Cooperate'; summary='Core cooperates with cache to speed access.' }
      ) }
    } else {
      $rootId = if($selId){ $selId } else { 'n4' }
      $ops += @{ type='add_nodes'; nodes=@(
        @{ id='cache'; label='Cache'; name='Cache'; summary='Speeds up data access.' },
        @{ id='core'; label='Core'; name='Core'; summary='Executes instructions and controls operations.' }
      ) }
      $ops += @{ type='add_edges'; edges=@(
        @{ id='e-cache'; source=$rootId; target='cache'; name='Composed of'; summary='CPU includes cache.' },
        @{ id='e-core'; source=$rootId; target='core'; name='Composed of'; summary='CPU includes cores.' }
      ) }
    }
  }
  if($ops.Count -eq 0 -and (-not [string]::IsNullOrWhiteSpace($msg))){
    $anchor = if($selId){ $selId } else { 'n1' }
    $ops += @{ type = 'add_nodes'; attachTo = $anchor; nodes = @(
      @{ id = ('ai-' + [Guid]::NewGuid().ToString().Substring(0,8)); label = $msg; name = 'Note'; summary = 'Added by AI based on message.' }
    ) }
  }
  return $ops
}

function ParseTargets($msg){
  $out = New-Object System.Collections.Generic.List[string]
  try {
    $q = [System.Text.RegularExpressions.Regex]::Matches($msg, '“([^”]+)”|"([^"]+)"|‘([^’]+)’|\'([^']+)\'')
    foreach($m in $q){ for($i=1;$i -lt $m.Groups.Count;$i++){ $t = $m.Groups[$i].Value; if(-not [string]::IsNullOrWhiteSpace($t)){ [void]$out.Add($t.Trim()) } } }
  } catch {}
  try {
    $m2 = [System.Text.RegularExpressions.Regex]::Match($msg, '(?:添加|新增|创建)(?:一下|下)?([^，。\.\n]+)')
    if($m2.Success){ foreach($t in ($m2.Groups[1].Value -split '[，,、\s]+')){ if(-not [string]::IsNullOrWhiteSpace($t)){ [void]$out.Add($t.Trim()) } } }
  } catch {}
  try {
    $m3 = [System.Text.RegularExpressions.Regex]::Match($msg, '(?:删除)(?:一下|下)?([^，。\.\n]+)')
    if($m3.Success){ foreach($t in ($m3.Groups[1].Value -split '[，,、\s]+')){ if(-not [string]::IsNullOrWhiteSpace($t)){ [void]$out.Add($t.Trim()) } } }
  } catch {}
  return $out
}

function GenerateReply($payload, $ops){
  $msg = if($payload.message){ [string]$payload.message } else { '' }
  $sel = $payload.selection
  $nid = $null
  try { if($sel.nodes.Count -gt 0){ $nid = $sel.nodes[0] } } catch {}
  $label = ''
  try { $label = (($payload.graph.nodes | Where-Object { $_.id -eq $nid } | Select-Object -First 1).label) } catch {}
  $intro = ''
  if(($ops | Measure-Object).Count -eq 0){
    return ('为确保准确，请具体说明需要删除/新增的元素名称，或通过框选/点选选中它们，我会据此执行并给出完整说明。')
  }
  if(($msg -match '删除') -and (($msg -match '你自己') -or ($msg -match 'deepseek') -or ($msg -match '自我'))){
    $intro = '我是 DeepSeek 大模型，支持通用对话、推理与可视化编排。为了更好地介绍自己，我先清理当前画布，并以图的方式展示我的结构。'
  } elseif($msg -match '(CPU|中央处理器)'){
  if($msg -match '(CPU|中央处理器)'){
    $intro = 'CPU 是计算机的核心，负责取指、解码、执行与写回；控制单元协调寄存器与缓存以提升吞吐。'
    if($label){ $intro += (' 本次以 ' + $label + ' 为焦点展开结构。') }
  } elseif($msg -match '(计算机|computer)'){
    $intro = '计算机由硬件与软件协作完成信息处理：硬件提供算力与存储，软件封装算法与应用以驱动硬件。'
    if($label){ $intro += (' 这次以 ' + $label + ' 为锚点补全相关组成。') }
  } else {
    $intro = ('好的，已理解你的问题：' + $msg + '。先给出简要说明，同时在图上做适度补充。')
  }
  $addedNodes = @()
  $addedEdges = @()
  $childId = $null
  foreach($op in $ops){
    if($op.type -eq 'add_nodes'){ foreach($n in $op.nodes){ $addedNodes += ($n.label -as [string]) } }
    if($op.type -eq 'add_edges'){ foreach($e in $op.edges){ $addedEdges += (($e.source+'->'+$e.target) -as [string]) } }
    if($op.type -eq 'create_child_canvas'){ $childId = $op.canvasId }
  }
  $parts = @()
  if($childId){ $parts += '展开子画布以聚焦细节' }
  if($addedNodes.Count -gt 0){ $parts += ('新增节点：' + ([string]::Join('、', ($addedNodes[0..([Math]::Min($addedNodes.Count-1,5))]))) + ($addedNodes.Count -gt 6 ? ' 等' : '')) }
  if($addedEdges.Count -gt 0){ $parts += ('补充连接 ' + $addedEdges.Count + ' 条') }
  $side = if($parts.Count -gt 0){ ('顺便我也在当前' + (if($payload.activeCanvasId -eq 'main'){ '主画布' } else { '子画布' }) + '中' + ([string]::Join('，', $parts)) + '，方便你继续探索。') } else { '当前图无需改动，我将以文字解释为主。' }
  return ($intro + "`n`n" + $side)
}

while($true){
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $path = $req.Url.AbsolutePath.TrimStart('/'); if([string]::IsNullOrWhiteSpace($path)){ $path = "index.html" }
    $Global:Metrics.requests = $Global:Metrics.requests + 1
    ExpireSessions
  if($path -eq "oauth/token"){
      try {
        $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
        $body = $reader.ReadToEnd(); $reader.Close()
        $data = $null
        try { $data = $body | ConvertFrom-Json } catch {}
        $token = IssueToken $data.client_id $data.client_secret
        if(-not $token){ $res.StatusCode = 400; $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"invalid_client"}'); $res.OutputStream.Write($bytes,0,$bytes.Length); $res.Close(); continue }
        $json = @{ access_token = $token; token_type = 'Bearer'; expires_in = 3600 } | ConvertTo-Json
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $res.ContentType = 'application/json'
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes,0,$bytes.Length)
        $res.Close()
        continue
      } catch { $res.StatusCode = 500; $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"oauth_failure"}'); $res.OutputStream.Write($bytes,0,$bytes.Length); $res.Close(); continue }
    }
    if($path -eq "api/ai/chat"){
      try {
        $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
        $body = $reader.ReadToEnd(); $reader.Close()
        $data = $null
        try { $data = $body | ConvertFrom-Json } catch {}
        $sessionId = if($data.sessionId){ $data.sessionId } else { 'default' }
        $s = EnsureSession $sessionId
        try { CheckRate $s } catch { $res.StatusCode = 429; $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"rate_limit"}'); $res.OutputStream.Write($bytes,0,$bytes.Length); $res.Close(); continue }
        $activeId = if($data.activeCanvasId){ $data.activeCanvasId } else { 'main' }
        $cv = GetCanvas $s $activeId
        if($cv.nodes.Count -eq 0 -and $data.graph){ $s.canvases[$activeId] = @{ nodes = @($data.graph.nodes); edges = @($data.graph.edges) } }
        PushUndo $s
        $result = $null
        try { $result = CallAIModel $data } catch { $result = @{ reply = $null; ops = (BuildOps $data) } }
        $ops = @($result.ops)
        ApplyOpsToSession $s $data $ops
        $reply = if($result.reply){ $result.reply } else { (GenerateReply $data $ops) }
        $Global:Metrics.chat_calls = $Global:Metrics.chat_calls + 1
        $out = @{ reply = $reply; ops = $ops }
        $json = $out | ConvertTo-Json -Depth 8
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $res.ContentType = "application/json"
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes,0,$bytes.Length)
        $res.Close()
        continue
      } catch {
        $res.StatusCode = 500
        $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"api failure"}')
        $res.OutputStream.Write($bytes,0,$bytes.Length)
        $res.Close()
        continue
      }
    }
    if($path -eq 'api/ai/stream'){
      try {
        $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
        $body = $reader.ReadToEnd(); $reader.Close()
        $data = $body | ConvertFrom-Json
        $sessionId = if($data.sessionId){ $data.sessionId } else { 'default' }
        $s = EnsureSession $sessionId
        $res.Headers['Cache-Control'] = 'no-cache'
        $res.ContentType = 'text/event-stream'
        $res.SendChunked = $true
        $ops = BuildOps $data
        ApplyOpsToSession $s $data $ops
        $Global:Metrics.stream_calls = $Global:Metrics.stream_calls + 1
        $ev1 = 'data: ' + (@{ type='meta'; msg='stream_start' } | ConvertTo-Json) + "`n`n"
        $b1 = [System.Text.Encoding]::UTF8.GetBytes($ev1)
        $res.OutputStream.Write($b1,0,$b1.Length)
        Start-Sleep -Milliseconds 120
        $ev2 = 'data: ' + (@{ type='ops'; ops=$ops } | ConvertTo-Json -Depth 8) + "`n`n"
        $b2 = [System.Text.Encoding]::UTF8.GetBytes($ev2)
        $res.OutputStream.Write($b2,0,$b2.Length)
        Start-Sleep -Milliseconds 80
        $ev3 = 'data: ' + (@{ type='done' } | ConvertTo-Json) + "`n`n"
        $b3 = [System.Text.Encoding]::UTF8.GetBytes($ev3)
        $res.OutputStream.Write($b3,0,$b3.Length)
        $res.Close()
        continue
      } catch { $res.StatusCode = 500; $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"stream_failure"}'); $res.OutputStream.Write($bytes,0,$bytes.Length); $res.Close(); continue }
    }
    if($path -eq 'api/session/undo'){
      try {
        $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
        $body = $reader.ReadToEnd(); $reader.Close()
        $data = $body | ConvertFrom-Json
        $s = EnsureSession $data.sessionId
        if(-not $s -or $s.undo.Count -lt 1){ $res.StatusCode = 400; $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"no_undo"}'); $res.OutputStream.Write($bytes,0,$bytes.Length); $res.Close(); continue }
        $snap = $s.undo[0]; $s.undo = $s.undo[1..($s.undo.Count-1)]
        $s.redo = ,(@{ canvases = $s.canvases } | ConvertTo-Json -Depth 12) + $s.redo
        $s.canvases = (ConvertFrom-Json $snap).canvases
        $Global:Metrics.undo_calls = $Global:Metrics.undo_calls + 1
        $json = @{ ok=$true } | ConvertTo-Json
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $res.ContentType = 'application/json'
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes,0,$bytes.Length)
        $res.Close()
        continue
      } catch { $res.StatusCode = 500; $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"undo_failure"}'); $res.OutputStream.Write($bytes,0,$bytes.Length); $res.Close(); continue }
    }
    if($path -eq 'api/session/redo'){
      try {
        $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
        $body = $reader.ReadToEnd(); $reader.Close()
        $data = $body | ConvertFrom-Json
        $s = EnsureSession $data.sessionId
        if(-not $s -or $s.redo.Count -lt 1){ $res.StatusCode = 400; $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"no_redo"}'); $res.OutputStream.Write($bytes,0,$bytes.Length); $res.Close(); continue }
        $snap = $s.redo[0]; $s.redo = $s.redo[1..($s.redo.Count-1)]
        $s.undo = ,(@{ canvases = $s.canvases } | ConvertTo-Json -Depth 12) + $s.undo
        $s.canvases = (ConvertFrom-Json $snap).canvases
        $Global:Metrics.redo_calls = $Global:Metrics.redo_calls + 1
        $json = @{ ok=$true } | ConvertTo-Json
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $res.ContentType = 'application/json'
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes,0,$bytes.Length)
        $res.Close()
        continue
      } catch { $res.StatusCode = 500; $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"redo_failure"}'); $res.OutputStream.Write($bytes,0,$bytes.Length); $res.Close(); continue }
    }
    if($path -eq 'api/metrics'){
      $json = $Global:Metrics | ConvertTo-Json
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
      $res.ContentType = 'application/json'
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes,0,$bytes.Length)
      $res.Close()
      continue
    }
    if($path -eq 'api/session/canvas'){
      try {
        $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
        $body = $reader.ReadToEnd(); $reader.Close()
        $data = $body | ConvertFrom-Json
        $sessionId = if($data.sessionId){ $data.sessionId } else { 'default' }
        $activeId = if($data.activeCanvasId){ $data.activeCanvasId } else { 'main' }
        $s = EnsureSession $sessionId
        $cv = GetCanvas $s $activeId
        $json = @{ nodes = $cv.nodes; edges = $cv.edges } | ConvertTo-Json -Depth 12
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $res.ContentType = 'application/json'
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes,0,$bytes.Length)
        $res.Close()
        continue
      } catch { $res.StatusCode = 500; $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"canvas_failure"}'); $res.OutputStream.Write($bytes,0,$bytes.Length); $res.Close(); continue }
    }
    $file = Join-Path $Root $path
    if(-not (Test-Path $file)){ $res.StatusCode = 404; $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not Found"); $res.OutputStream.Write($bytes,0,$bytes.Length); $res.Close(); continue }
    $bytes = [System.IO.File]::ReadAllBytes($file)
    $res.ContentType = Get-ContentType($file)
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes,0,$bytes.Length)
    $res.Close()
  } catch {
    Write-Host "[server] error: $($_.Exception.Message)" -ForegroundColor Red
  }
  if($path -eq 'api/ai/validate'){
    try {
      $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
      $body = $reader.ReadToEnd(); $reader.Close()
      $data = $body | ConvertFrom-Json
      $endpoint = $data.endpoint
      $token = $data.token
      $payload = if($data.payload){ $data.payload } else { @{ sessionId='validate'; activeCanvasId='main'; selection=@{nodes=@();edges=@()}; graph=@{nodes=@();edges=@()}; message=(if($data.message){ $data.message } else { 'health' }) } }
      $headers = @{ 'Content-Type'='application/json' }
      if($token){ $headers['Authorization'] = 'Bearer ' + $token }
      $json = $payload | ConvertTo-Json -Depth 12
      $resUp = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -Body $json -TimeoutSec 15
      $out = @{ ok=$true; reply=$resUp.reply; ops=$resUp.ops }
      $j = $out | ConvertTo-Json -Depth 8
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($j)
      $res.ContentType = 'application/json'
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes,0,$bytes.Length)
      $res.Close()
      continue
    } catch { $res.StatusCode = 502; $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"ok":false}'); $res.OutputStream.Write($bytes,0,$bytes.Length); $res.Close(); continue }
  }
  if($path -eq 'api/ai/test'){
    try {
      $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
      $body = $reader.ReadToEnd(); $reader.Close()
      $data = $body | ConvertFrom-Json
      $sessionId = if($data.sessionId){ $data.sessionId } else { 'default' }
      $s = EnsureSession $sessionId
      PushUndo $s
      $endpoint = if($data.endpoint){ $data.endpoint } else { 'http://localhost:'+($Port)+'/api/ai/chat' }
      $token = $data.token
      $payload = if($data.payload){ $data.payload } else { @{ sessionId=$sessionId; activeCanvasId='main'; selection=@{nodes=@('n4');edges=@()}; graph=@{nodes=@(@{id='n4';label='CPU'});edges=@()}; message='cpu' } }
      $headers = @{ 'Content-Type'='application/json' }
      if($token){ $headers['Authorization'] = 'Bearer ' + $token }
      $json = $payload | ConvertTo-Json -Depth 12
      $resUp = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -Body $json -TimeoutSec 15
      $ops = @($resUp.ops)
      ApplyOpsToSession $s $payload $ops
      $out = @{ ok=$true; appliedOps=$ops.Count; reply=$resUp.reply; metrics=$Global:Metrics }
      $j = $out | ConvertTo-Json -Depth 8
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($j)
      $res.ContentType = 'application/json'
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes,0,$bytes.Length)
      $res.Close()
      continue
    } catch { $res.StatusCode = 500; $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"test_failure"}'); $res.OutputStream.Write($bytes,0,$bytes.Length); $res.Close(); continue }
  }
}
