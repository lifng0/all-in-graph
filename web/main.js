// Simple front-end prototype without build tools

const state = {
  sessionId: 'demo',
  canvasStack: [{ id: 'main', title: '主画布' }],
  graphs: {
    main: {
      nodes: [
        { id: 'n1', x: 200, y: 180, label: '计算机', name: '计算机', summary: '计算机由硬件与软件组成，用于信息处理。', important: true },
        { id: 'n2', x: 480, y: 180, label: '硬件', name: '硬件', summary: '计算机的物理组成，包括CPU、内存、存储等。' },
        { id: 'n3', x: 480, y: 320, label: '软件 $f(x)=x^2$', name: '软件', summary: '运行在硬件上的程序与数据。' },
        { id: 'n4', x: 760, y: 180, label: 'CPU', name: 'CPU', summary: '中央处理器，负责运算与控制。' },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', name: '组成', summary: '计算机由硬件组成。' },
        { id: 'e2', source: 'n1', target: 'n3', name: '组成', summary: '计算机由软件组成。' },
        { id: 'e3', source: 'n2', target: 'n4', name: '包含', summary: '硬件包含CPU。' },
      ],
    },
  },
  childCanvas: { n1: { id: 'c-n1', title: '计算机 - 细节', nodes: [ { id: 'n1-1', x: 300, y: 240, label: '体系结构 $$E=mc^2$$', name: '体系结构', summary: '计算机体系结构的要点。' } ], edges: [] } },
  childCanvasMap: { 'c-n1': 'n1' },
  selection: null,
  activeCanvasId: 'main',
  contextTarget: null,
  selected: null,
  multiSelected: [],
  logs: [],
  tipCache: new Map(),
  view: { tx: 0, ty: 0, scale: 1 },
  sessionTitle: 'Demo 会话',
};
// 每会话独立聊天缓存
state.sessionChats = {};
state.sessions = [];
state.currentSessionId = null;
state.sessionStore = {};

const svg = document.getElementById('graphSvg');
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const breadcrumbEl = document.getElementById('breadcrumb');
const canvasTree = document.getElementById('canvasTree');
const cm = document.getElementById('contextMenu');
const cmExplain = document.getElementById('cmExplain');
const btnBack = document.getElementById('btnBack');
const overlayTopLeft = document.getElementById('overlayTopLeft');
const hoverTip = document.getElementById('hoverTip');
const canvasTreeOverlay = document.getElementById('canvasTreeOverlay');
const canvasTreePanel = document.getElementById('canvasTreePanel');
const canvasMenu = document.getElementById('canvasMenu');
const cmCanvasRename = document.getElementById('cmCanvasRename');
const cmCanvasDelete = document.getElementById('cmCanvasDelete');
const rightTreePanel = document.getElementById('rightTreePanel');
const sessionMenu = document.getElementById('sessionMenu');
const smRename = document.getElementById('smRename');
const smDelete = document.getElementById('smDelete');
const sessionTitleEl = document.querySelector('.session-title');
const btnNewSession = document.getElementById('btnNewSession');
const sessionsListEl = document.getElementById('sessionsList');

function currentGraph(){
  const id = state.activeCanvasId;
  if(id==='main') return state.graphs.main;
  // child canvas demo
  for(const k in state.childCanvas){
    if(state.childCanvas[k].id===id) return state.childCanvas[k];
  }
  return state.graphs.main;
}

function renderBreadcrumb(){
  const stack = state.canvasStack.map(c=>c.title).join(' / ');
  breadcrumbEl.textContent = `${state.sessionTitle} / ${stack}`;
}

function renderMessages(){
  const sid = state.currentSessionId || 'default';
  const list = state.sessionChats[sid] || [];
  messagesEl.innerHTML = '';
  list.forEach(m=>{
    const div = document.createElement('div'); div.className = m.role==='user' ? 'msg user' : 'msg';
    div.innerHTML = marked.parse(m.content);
    messagesEl.appendChild(div);
    if(m.role!=='user') try{ renderMathInElement(div, {delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}]}); }catch{}
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
function genId(prefix){ return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random()*1e6).toString(36)}`; }
function renderSessionsList(){ if(!sessionsListEl) return; sessionsListEl.innerHTML=''; state.sessions.forEach(s=>{ const li=document.createElement('li'); li.textContent=s.title; li.dataset.sid=s.id; if(s.id===state.currentSessionId) li.classList.add('active'); li.onclick=()=>switchSession(s.id); li.addEventListener('contextmenu',(ev)=>{ ev.preventDefault(); state.currentSessionId=s.id; openSessionMenu(ev.clientX, ev.clientY); }); sessionsListEl.appendChild(li); }); }
function switchSession(sessionId){ const store=state.sessionStore[sessionId]; if(!store) return; state.currentSessionId=sessionId; state.sessionTitle=store.title; state.canvasStack=[...store.canvasStack]; state.activeCanvasId=store.activeCanvasId; state.graphs=JSON.parse(JSON.stringify(store.graphs)); state.childCanvas=JSON.parse(JSON.stringify(store.childCanvas)); state.childCanvasMap=JSON.parse(JSON.stringify(store.childCanvasMap)); renderSessionsList(); renderBreadcrumb(); renderGraph(); hideCanvasTreeOverlay(); }
// 渲染切换后的聊天
function switchSession(sessionId){ const store=state.sessionStore[sessionId]; if(!store) return; state.currentSessionId=sessionId; state.sessionTitle=store.title; state.canvasStack=[...store.canvasStack]; state.activeCanvasId=store.activeCanvasId; state.graphs=JSON.parse(JSON.stringify(store.graphs)); state.childCanvas=JSON.parse(JSON.stringify(store.childCanvas)); state.childCanvasMap=JSON.parse(JSON.stringify(store.childCanvasMap)); renderSessionsList(); renderBreadcrumb(); renderGraph(); renderMessages(); hideCanvasTreeOverlay(); }
function createNewSession(){ const id=genId('s'); const createdAt=Date.now(); const title='新会话'; const store={ id, title, createdAt, graphs:{ main:{ nodes:[], edges:[] } }, childCanvas:{}, childCanvasMap:{}, canvasStack:[{id:'main', title:'主画布'}], activeCanvasId:'main' }; try{ state.sessionStore[id]=store; state.sessions.push({id,title,createdAt}); switchSession(id); } catch(e){ delete state.sessionStore[id]; state.sessions=state.sessions.filter(s=>s.id!==id); throw e; } }

function renderCanvasTree(){ renderSessionsList(); }

function buildCanvasTree(){
  const frag = document.createDocumentFragment();
  const title = document.createElement('div'); title.className='title'; title.textContent = '主画布与子画布'; frag.appendChild(title);
  const ul = document.createElement('ul'); ul.className='tree';
  const rootLi = document.createElement('li');
  const rootNode = document.createElement('span'); rootNode.className='node'; rootNode.setAttribute('role','button'); rootNode.tabIndex=0;
  const icon = document.createElement('div'); icon.className='icon'; rootNode.appendChild(icon);
  rootNode.appendChild(document.createTextNode('主画布'));
  rootNode.onclick = ()=>{ hideCanvasTreeOverlay(); switchCanvas('main','主画布'); };
  rootNode.addEventListener('mouseenter', (ev)=>{ showHoverTip('进入主画布', ev.clientX + window.scrollX, ev.clientY + window.scrollY); });
  rootNode.addEventListener('mouseleave', hideHoverTip);
  rootLi.appendChild(rootNode);
  const childUl = document.createElement('ul'); childUl.className='tree';
  Object.keys(state.childCanvas).forEach(nodeId=>{
    const child = state.childCanvas[nodeId];
    const li = document.createElement('li');
    const node = document.createElement('span'); node.className='node'; node.setAttribute('role','button'); node.tabIndex=0;
    const icon2 = document.createElement('div'); icon2.className='icon'; node.appendChild(icon2);
    const mainNode = state.graphs.main.nodes.find(n=>n.id===nodeId);
    node.appendChild(document.createTextNode(`${mainNode?.label||nodeId} → ${child.title}`));
    // thumbnail
    const thumb = makeCanvasThumbnail(child); thumb.classList.add('thumb','loading');
    thumb.addEventListener('load', ()=>thumb.classList.remove('loading'));
    thumb.addEventListener('click', ()=>{ hideCanvasTreeOverlay(); switchCanvas(child.id, child.title); });
    node.appendChild(thumb);
    const disabled = !child || !child.id;
    if(disabled){ node.classList.add('disabled'); }
    node.onclick = ()=>{ if(disabled) return; hideCanvasTreeOverlay(); switchCanvas(child.id, child.title); };
    node.addEventListener('mouseenter', (ev)=>{ showHoverTip('进入子画布', ev.clientX + window.scrollX, ev.clientY + window.scrollY); });
    node.addEventListener('mouseleave', hideHoverTip);
    li.appendChild(node);
    childUl.appendChild(li);
  });
  rootLi.appendChild(childUl);
  ul.appendChild(rootLi);
  const container = document.createElement('div');
  container.appendChild(ul);
  frag.appendChild(container);
  return frag;
}

function makeCanvasThumbnail(child){
  // Build a miniature SVG preview of the child canvas content
  const svgEl = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svgEl.setAttribute('width', 120); svgEl.setAttribute('height', 80);
  const nodes = child.nodes||[]; const edges = child.edges||[];
  let minX=0,minY=0,maxX=0,maxY=0;
  if(nodes.length){
    minX = Math.min(...nodes.map(n=>n.x)); minY = Math.min(...nodes.map(n=>n.y));
    maxX = Math.max(...nodes.map(n=>n.x)); maxY = Math.max(...nodes.map(n=>n.y));
  }
  const pad = 10; const width = Math.max(1, maxX-minX+40); const height = Math.max(1, maxY-minY+40);
  const sx = (120 - pad*2) / width; const sy = (80 - pad*2) / height; const s = Math.min(sx, sy);
  // draw edges
  edges.forEach(e=>{
    const sNode = nodes.find(n=>n.id===e.source); const tNode = nodes.find(n=>n.id===e.target); if(!sNode||!tNode) return;
    const l = document.createElementNS('http://www.w3.org/2000/svg','line');
    l.setAttribute('x1', pad + (sNode.x-minX)*s);
    l.setAttribute('y1', pad + (sNode.y-minY)*s);
    l.setAttribute('x2', pad + (tNode.x-minX)*s);
    l.setAttribute('y2', pad + (tNode.y-minY)*s);
    l.setAttribute('stroke', '#aaa'); l.setAttribute('stroke-width','1');
    svgEl.appendChild(l);
  });
  // draw nodes
  nodes.forEach(n=>{
    const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
    r.setAttribute('x', pad + (n.x-minX)*s - 8);
    r.setAttribute('y', pad + (n.y-minY)*s - 6);
    r.setAttribute('width', 16); r.setAttribute('height', 12);
    r.setAttribute('rx', 3);
    r.setAttribute('fill', '#fff'); r.setAttribute('stroke', '#999');
    svgEl.appendChild(r);
  });
  return svgEl;
}

function showCanvasTreeOverlay(){
  canvasTreePanel.innerHTML = '';
  const content = buildCanvasTree();
  canvasTreePanel.appendChild(content);
  const area = document.querySelector('.canvas-area'); if(area) area.classList.add('dim');
  canvasTreeOverlay.classList.add('show');
  canvasTreeOverlay.classList.remove('hidden');
}
function hideCanvasTreeOverlay(){ canvasTreeOverlay.classList.remove('show'); canvasTreeOverlay.classList.add('hidden'); const area = document.querySelector('.canvas-area'); if(area) area.classList.remove('dim'); }

canvasTreeOverlay.addEventListener('click', (ev)=>{ if(ev.target===canvasTreeOverlay) hideCanvasTreeOverlay(); });

function openSessionMenu(px, py){
  sessionMenu.classList.remove('hidden');
  const sidebar = document.querySelector('.sidebar');
  const sRect = sidebar.getBoundingClientRect();
  const mRect = sessionMenu.getBoundingClientRect();
  let x = px - sRect.left - window.scrollX;
  let y = py - sRect.top - window.scrollY;
  x = Math.max(8, Math.min(x, sRect.width - mRect.width - 8));
  y = Math.max(8, Math.min(y, sRect.height - mRect.height - 8));
  sessionMenu.style.left = x + 'px';
  sessionMenu.style.top = y + 'px';
}

if(sessionTitleEl){
  sessionTitleEl.addEventListener('contextmenu', (ev)=>{ ev.preventDefault(); openSessionMenu(ev.clientX, ev.clientY); });
  sessionTitleEl.addEventListener('dblclick', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); });
}
if(smRename){
  smRename.addEventListener('click', ()=>{
    sessionMenu.classList.add('hidden');
    const input = document.createElement('input');
    input.type = 'text'; input.value = state.sessionTitle; input.style.border = '1px solid var(--line)'; input.style.borderRadius = '6px'; input.style.padding = '4px 6px';
    sessionTitleEl.replaceChildren(input);
    input.focus();
    const commit = ()=>{ const val = input.value.trim(); if(val){ state.sessionTitle = val; sessionTitleEl.textContent = state.sessionTitle; renderBreadcrumb(); } else { sessionTitleEl.textContent = state.sessionTitle; } };
    input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ commit(); } if(e.key==='Escape'){ sessionTitleEl.textContent = state.sessionTitle; } });
    input.addEventListener('blur', commit);
  });
}
if(smDelete){
  smDelete.addEventListener('click', ()=>{ sessionMenu.classList.add('hidden'); if(confirm('确认删除当前会话？')){ state.graphs.main.nodes = []; state.graphs.main.edges = []; state.childCanvas = {}; state.childCanvasMap = {}; renderGraph(); hideCanvasTreeOverlay(); }});
}

if(btnNewSession){ btnNewSession.addEventListener('click', ()=>{ createNewSession(); }); }

function renderSessionsListMinimal(){ sessionsListEl.innerHTML=''; (state.sessions||[]).forEach(s=>{ const li=document.createElement('li'); li.textContent=s.title; li.dataset.sid=s.id; if(s.title===state.sessionTitle) li.classList.add('active'); li.onclick=()=>{ state.sessionTitle=s.title; sessionTitleEl.textContent=state.sessionTitle; state.canvasStack=[{id:'main', title:'主画布'}]; state.activeCanvasId='main'; state.graphs={ main:{ nodes:[], edges:[] } }; state.childCanvas={}; state.childCanvasMap={}; renderBreadcrumb(); renderCanvasTree(); renderGraph(); hideCanvasTreeOverlay(); }; sessionsListEl.appendChild(li); }); }

function switchCanvas(id,title){
  state.activeCanvasId = id;
  const idx = state.canvasStack.findIndex(c=>c.id===id);
  if(idx===-1) state.canvasStack.push({id,title});
  else state.canvasStack = state.canvasStack.slice(0, idx+1);
  const area = document.querySelector('.canvas-area');
  if(area){ area.style.opacity='0'; area.style.transform='translateY(6px)'; }
  renderGraph();
  renderBreadcrumb();
  renderCanvasTree();
  renderOverlay();
  if(area){ setTimeout(()=>{ area.style.opacity='1'; area.style.transform='translateY(0)'; }, 10); }
}

function clearSvg(){
  while(svg.firstChild) svg.removeChild(svg.firstChild);
}

function defArrow(){
  const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
  const marker = document.createElementNS('http://www.w3.org/2000/svg','marker');
  marker.setAttribute('id','arrow');
  marker.setAttribute('markerWidth','10');
  marker.setAttribute('markerHeight','10');
  marker.setAttribute('refX','6');
  marker.setAttribute('refY','3');
  marker.setAttribute('orient','auto');
  const path = document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d','M0,0 L6,3 L0,6 Z');
  path.setAttribute('fill','#333');
  marker.appendChild(path);
  defs.appendChild(marker);
  svg.appendChild(defs);
}

function renderGraph(){
  clearSvg();
  defArrow();
  const graph = currentGraph();
  const isChild = state.activeCanvasId!=='main';
  // 视口与根节点分层，支持平移缩放
  const viewport = document.createElementNS('http://www.w3.org/2000/svg','g');
  viewport.setAttribute('id','viewport');
  viewport.setAttribute('transform', `translate(${state.view.tx},${state.view.ty}) scale(${state.view.scale})`);
  svg.appendChild(viewport);
  // 移除SVG内父节点提示，统一由 overlayTopLeft 显示
  const rootG = document.createElementNS('http://www.w3.org/2000/svg','g');
  rootG.setAttribute('id','rootG');
  viewport.appendChild(rootG);
  // nodes first for measurement
  graph.nodes.forEach(n=>{
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('x', n.x);
    rect.setAttribute('y', n.y);
    rect.setAttribute('width', n.w||160);
    rect.setAttribute('height', n.h||40);
    rect.setAttribute('rx', 8);
    rect.classList.add('node');
    if(n.important) rect.classList.add('important');
    rect.dataset.nodeId = n.id;
    rect.addEventListener('dblclick', ()=>onDoubleClickNode(n));
    rect.addEventListener('click', ()=>selectNode(g, rect, n));
    rect.addEventListener('mousedown', (ev)=>{ if(ev.button!==0) return; ev.stopPropagation(); startDragNode(ev, n, rect); });
    rect.addEventListener('contextmenu', ev=>{
      ev.preventDefault();
      state.contextTarget = {type:'node', id:n.id};
      openContextMenu(ev.clientX + window.scrollX, ev.clientY + window.scrollY);
    });
    g.appendChild(rect);
    const text = document.createElementNS('http://www.w3.org/2000/svg','foreignObject');
    text.setAttribute('x', n.x+10);
    text.setAttribute('y', n.y+10);
    text.setAttribute('width', (n.w||160)-20);
    text.setAttribute('height', (n.h||40)-20);
    const div = document.createElement('div');
    div.style.fontSize = '14px';
    div.style.overflow = 'hidden';
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.justifyContent = 'center';
    div.style.userSelect = 'none';
    div.innerHTML = marked.parse(n.label);
    // 修复公式渲染：节点标签也执行 KaTeX 渲染
    try { renderMathInElement(div, {delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}], throwOnError:false, trust:true}); } catch {}
    // 内容区也可选中与提示
    div.addEventListener('click', ()=>selectNode(g, rect, n));
    div.addEventListener('dblclick', (ev)=>{ ev.preventDefault(); onDoubleClickNode(n); });
    div.addEventListener('mouseenter', (ev)=>{
      const html = getSummary('node', n.id, n.label, n.summary, n.name);
      showHoverTip(html, ev.clientX + window.scrollX, ev.clientY + window.scrollY);
    });
    div.addEventListener('mouseleave', hideHoverTip);
    div.addEventListener('contextmenu', (ev)=>{
      ev.preventDefault(); hideHoverTip();
      state.contextTarget = {type:'node', id:n.id};
      openContextMenu(ev.clientX + window.scrollX, ev.clientY + window.scrollY);
    });
    text.appendChild(div);
    g.appendChild(text);
    // pixel badge indicates child canvas
    if(state.childCanvas[n.id]){
      const badge = document.createElementNS('http://www.w3.org/2000/svg','rect');
      badge.setAttribute('x', n.x+((n.w||160)-10));
      badge.setAttribute('y', n.y+4);
      badge.setAttribute('width', 6);
      badge.setAttribute('height', 6);
      badge.classList.add('pixel-badge');
      g.appendChild(badge);
    }
    // dynamic size measure
    setTimeout(()=>{
      const w = Math.max(160, div.offsetWidth + 20);
      const h = Math.max(40, div.offsetHeight + 20);
      n.w = w; n.h = h;
      rect.setAttribute('width', w);
      rect.setAttribute('height', h);
      text.setAttribute('width', w-20);
      text.setAttribute('height', h-20);
    }, 0);
    rootG.appendChild(g);
  });
  // edges after nodes
  graph.edges.forEach(e=>{
    const s = graph.nodes.find(n=>n.id===e.source);
    const t = graph.nodes.find(n=>n.id===e.target);
    if(!s||!t) return;
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.classList.add('edge');
    const sw = s.w||160, sh = s.h||40, tw = t.w||160, th = t.h||40;
    line.setAttribute('x1', s.x+sw);
    line.setAttribute('y1', s.y+sh/2);
    line.setAttribute('x2', t.x);
    line.setAttribute('y2', t.y+th/2);
    line.dataset.edgeId = e.id;
    line.addEventListener('click', ()=>selectEdge(line));
    line.addEventListener('dblclick', ()=>onDoubleClickEdge(e));
    line.addEventListener('mouseenter', (ev)=>{ const html = getSummary('edge', e.id, e.name, e.summary); showHoverTip(html, ev.clientX + window.scrollX, ev.clientY + window.scrollY); });
    line.addEventListener('mouseleave', hideHoverTip);
    rootG.appendChild(line);
    // 热区：透明粗线用于更友好的点击命中
    const hit = document.createElementNS('http://www.w3.org/2000/svg','line');
    hit.classList.add('edge-hit');
    hit.setAttribute('x1', line.getAttribute('x1'));
    hit.setAttribute('y1', line.getAttribute('y1'));
    hit.setAttribute('x2', line.getAttribute('x2'));
    hit.setAttribute('y2', line.getAttribute('y2'));
    hit.addEventListener('click', ()=>selectEdge(line));
    hit.addEventListener('dblclick', ()=>onDoubleClickEdge(e));
    hit.addEventListener('contextmenu', (ev)=>{ ev.preventDefault(); hideHoverTip(); state.contextTarget = {type:'edge', id:e.id}; openContextMenu(ev.clientX + window.scrollX, ev.clientY + window.scrollY); });
    hit.addEventListener('mouseenter', (ev)=>{ const html = getSummary('edge', e.id, e.name, e.summary); showHoverTip(html, ev.clientX + window.scrollX, ev.clientY + window.scrollY); });
    hit.addEventListener('mouseleave', hideHoverTip);
    rootG.appendChild(hit);
    // 显示箭头名称
    const midX = (parseFloat(line.getAttribute('x1')) + parseFloat(line.getAttribute('x2'))) / 2;
    const midY = (parseFloat(line.getAttribute('y1')) + parseFloat(line.getAttribute('y2'))) / 2;
    const label = document.createElementNS('http://www.w3.org/2000/svg','text');
    label.setAttribute('x', midX + 6);
    label.setAttribute('y', midY - 6);
    label.setAttribute('fill', '#555');
    label.setAttribute('font-size', '12');
    label.textContent = e.name || '';
    label.style.userSelect = 'none';
    label.addEventListener('dblclick', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); try{ window.getSelection()?.removeAllRanges(); }catch{} const name = prompt('编辑箭头名称', e.name||''); if(name!==null){ e.name = name; renderGraph(); } });
    label.addEventListener('contextmenu', (ev)=>{ ev.preventDefault(); hideHoverTip(); state.contextTarget = {type:'edge', id:e.id}; openContextMenu(ev.clientX + window.scrollX, ev.clientY + window.scrollY); });
  rootG.appendChild(label);
  });
  if(isChild){ centerGraph(graph, rootG); }
}

// selection rectangle
let selecting = false, selStart = null, selRectEl = null;
function toSvgPoint(ev){
  const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
  const ctm = svg.getScreenCTM();
  if(ctm){ const p = pt.matrixTransform(ctm.inverse()); return {x:p.x, y:p.y}; }
  const r = svg.getBoundingClientRect(); return {x: ev.clientX - r.left, y: ev.clientY - r.top};
}
function toSvgClient(x, y){
  const pt = svg.createSVGPoint(); pt.x = x; pt.y = y;
  const ctm = svg.getScreenCTM();
  if(ctm){ const p = pt.matrixTransform(ctm.inverse()); return {x:p.x, y:p.y}; }
  const r = svg.getBoundingClientRect(); return {x: x - r.left, y: y - r.top};
}
let clickBlank = false;
svg.addEventListener('mousedown', (ev)=>{
  if(ev.button!==0) return; // only left
  clickBlank = (ev.target === svg);
  const p = toSvgPoint(ev);
  selecting = true; selStart = p;
  if(selRectEl){ try{ svg.removeChild(selRectEl); }catch{} selRectEl=null; }
});
svg.addEventListener('mousemove', (ev)=>{
  if(!selecting) return;
  const p = toSvgPoint(ev);
  const dist = Math.hypot(p.x - selStart.x, p.y - selStart.y);
  if(!selRectEl && dist < 3) return; // threshold避免误触
  if(!selRectEl){ selRectEl = document.createElementNS('http://www.w3.org/2000/svg','rect'); selRectEl.classList.add('selection-rect'); svg.appendChild(selRectEl); }
  const x = Math.min(selStart.x, p.x);
  const y = Math.min(selStart.y, p.y);
  const w = Math.abs(p.x - selStart.x);
  const h = Math.abs(p.y - selStart.y);
  const viewW = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal.width : svg.clientWidth;
  const viewH = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.height ? svg.viewBox.baseVal.height : svg.clientHeight;
  const cx = Math.max(0, Math.min(x, viewW));
  const cy = Math.max(0, Math.min(y, viewH));
  selRectEl.setAttribute('x', cx);
  selRectEl.setAttribute('y', cy);
  selRectEl.setAttribute('width', Math.max(0, Math.min(w, viewW - cx)));
  selRectEl.setAttribute('height', Math.max(0, Math.min(h, viewH - cy)));
});
svg.addEventListener('mouseup', (ev)=>{
  if(!selecting) return; selecting=false;
  if(selRectEl){ highlightSelection(); try{ svg.removeChild(selRectEl); }catch{} selRectEl=null; }
  else if(clickBlank && ev.button===0){ clearSelection(); }
});

function highlightSelection(){
  const rx = parseFloat(selRectEl.getAttribute('x'));
  const ry = parseFloat(selRectEl.getAttribute('y'));
  const rw = parseFloat(selRectEl.getAttribute('width'));
  const rh = parseFloat(selRectEl.getAttribute('height'));
  const ids = [];
  document.querySelectorAll('[data-node-id]').forEach(el=>{
    const nx = parseFloat(el.getAttribute('x'));
    const ny = parseFloat(el.getAttribute('y'));
    const nw = parseFloat(el.getAttribute('width'));
    const nh = parseFloat(el.getAttribute('height'));
    const inside = !(nx+nw < rx || nx > rx+rw || ny+nh < ry || ny > ry+rh);
    el.classList.toggle('selected', inside);
    if(inside) ids.push(el.dataset.nodeId);
  });
  // 线段与矩形相交检测
  function pointInRect(px,py){ return px>=rx && px<=rx+rw && py>=ry && py<=ry+rh; }
  function segIntersects(p1,p2,q1,q2){
    function cross(ax,ay,bx,by){ return ax*by - ay*bx; }
    function onSeg(a,b,c){ return Math.min(a.x,b.x)<=c.x && c.x<=Math.max(a.x,b.x) && Math.min(a.y,b.y)<=c.y && c.y<=Math.max(a.y,b.y); }
    const d1={x:p2.x-p1.x,y:p2.y-p1.y}; const d2={x:q2.x-q1.x,y:q2.y-q1.y};
    const denom = cross(d1.x,d1.y,d2.x,d2.y);
    if(denom===0){ if(cross(q1.x-p1.x,q1.y-p1.y,d1.x,d1.y)!==0) return false; return onSeg(p1,p2,q1)||onSeg(p1,p2,q2)||onSeg(q1,q2,p1)||onSeg(q1,q2,p2); }
    const t = cross(q1.x-p1.x,q1.y-p1.y,d2.x,d2.y)/denom;
    const u = cross(q1.x-p1.x,q1.y-p1.y,d1.x,d1.y)/denom;
    return t>=0 && t<=1 && u>=0 && u<=1;
  }
  const rTL={x:rx,y:ry}, rTR={x:rx+rw,y:ry}, rBL={x:rx,y:ry+rh}, rBR={x:rx+rw,y:ry+rh};
  document.querySelectorAll('.edge').forEach(line=>{
    const x1 = parseFloat(line.getAttribute('x1'));
    const y1 = parseFloat(line.getAttribute('y1'));
    const x2 = parseFloat(line.getAttribute('x2'));
    const y2 = parseFloat(line.getAttribute('y2'));
    const p1={x:x1,y:y1}, p2={x:x2,y:y2};
    const intersect = pointInRect(p1.x,p1.y) || pointInRect(p2.x,p2.y) ||
      segIntersects(p1,p2,rTL,rTR) || segIntersects(p1,p2,rTR,rBR) ||
      segIntersects(p1,p2,rBR,rBL) || segIntersects(p1,p2,rBL,rTL);
    line.classList.toggle('selected', intersect);
  });
  state.multiSelected = ids;
}

function openContextMenu(px,py){
  hideHoverTip();
  cm.classList.remove('hidden');
  const area = document.querySelector('.canvas-area');
  const aRect = area.getBoundingClientRect();
  const menuRect = cm.getBoundingClientRect();
  const vw = aRect.width, vh = aRect.height;
  let x = px - aRect.left - window.scrollX;
  let y = py - aRect.top - window.scrollY;
  if(x + menuRect.width > vw) x = vw - menuRect.width - 8;
  if(y + menuRect.height > vh) y = vh - menuRect.height - 8;
  cm.style.left = x + 'px';
  cm.style.top = y + 'px';
}
document.body.addEventListener('click', (ev)=>{ cm.classList.add('hidden'); if(canvasMenu && !canvasMenu.classList.contains('hidden') && !canvasMenu.contains(ev.target)) canvasMenu.classList.add('hidden'); });

// 悬停提示工具
function showHoverTip(content, x, y){
  hoverTip.innerHTML = content;
  hoverTip.classList.remove('hidden');
  const area = document.querySelector('.canvas-area');
  const aRect = area.getBoundingClientRect();
  const rect = hoverTip.getBoundingClientRect();
  const vw = aRect.width, vh = aRect.height;
  let nx = (x - aRect.left - window.scrollX) + 12;
  let ny = (y - aRect.top - window.scrollY) + 12;
  if(nx + rect.width > vw) nx = vw - rect.width - 8;
  if(ny + rect.height > vh) ny = vh - rect.height - 8;
  hoverTip.style.left = nx + 'px';
  hoverTip.style.top = ny + 'px';
  hoverTip.classList.add('show');
}
function hideHoverTip(){ hoverTip.classList.remove('show'); hoverTip.classList.add('hidden'); }
function getSummary(type, id, label, summary, name){
  const key = type+':'+id;
  if(state.tipCache && state.tipCache.has(key)) return state.tipCache.get(key);
  const title = (label||name||id);
  const md = `**${title}**\n\n${summary?summary:'- 概要信息由 AI 维护'}\n\n- 类型：${type}`;
  const html = marked.parse(md);
  if(state.tipCache) state.tipCache.set(key, html);
  return html;
}

function toClientXY(x, y){
  const pt = svg.createSVGPoint(); pt.x = x; pt.y = y;
  const ctm = svg.getScreenCTM();
  if(ctm){ const p = pt.matrixTransform(ctm); return {x:p.x, y:p.y}; }
  const r = svg.getBoundingClientRect(); return {x: x + r.left, y: y + r.top};
}

function elementScreenPos(target){
  const g = currentGraph();
  if(target.type==='node'){
    const n = g.nodes.find(x=>x.id===target.id); if(!n) return null;
    const cx = n.x + (n.w||160)/2; const cy = n.y + (n.h||40)/2;
    return toClientXY(cx, cy);
  }
  if(target.type==='edge'){
    const e = g.edges.find(x=>x.id===target.id); if(!e) return null;
    const s = g.nodes.find(x=>x.id===e.source); const t = g.nodes.find(x=>x.id===e.target); if(!s||!t) return null;
    const mx = s.x + (s.w||160); const my = s.y + (s.h||40)/2; const tx = t.x; const ty = t.y + (t.h||40)/2;
    return toClientXY((mx+tx)/2, (my+ty)/2);
  }
  return null;
}

function buildExplainMessage(target){
  const g = currentGraph();
  if(target.type==='node'){
    const n = g.nodes.find(x=>x.id===target.id); if(!n) return '解释选中节点';
    const rels = g.edges.filter(e=>e.source===n.id||e.target===n.id).map(e=>{
      const other = e.source===n.id ? g.nodes.find(x=>x.id===e.target) : g.nodes.find(x=>x.id===e.source);
      return `${e.name||'关系'}: ${other?.label||other?.id||''}`;
    }).join('\n');
    return `请解释节点"${n.label}"，并结合关联关系：\n${rels}\n类型:${n.type||'概念'}，需要简洁要点。`;
  } else {
    const e = g.edges.find(x=>x.id===target.id); if(!e) return '解释选中连线';
    const s = g.nodes.find(x=>x.id===e.source); const t = g.nodes.find(x=>x.id===e.target);
    return `请解释关系"${e.name||'关系'}"，从 ${s?.label||e.source} 到 ${t?.label||e.target} 的含义与约束。`;
  }
}

async function explainTarget(target){
  const pos = elementScreenPos(target);
  if(pos) showHoverTip('解释中…', pos.x, pos.y);
  const message = buildExplainMessage(target);
  let html = null;
  let replyText = null;
  try {
    const payload = buildAIPayload(message);
    if(target.type==='node') payload.selection = { nodes: [target.id], edges: [] };
    if(target.type==='edge') payload.selection = { nodes: [], edges: [target.id] };
    const res = await callAI(payload).catch(async ()=> await mockAI(payload));
    replyText = res?.reply || '暂无解释';
    html = marked.parse(replyText);
    if(res && Array.isArray(res.ops)) { applyOps(res.ops, payload); }
  } catch {
    replyText = '请求失败，请稍后重试';
    html = marked.parse(replyText);
  }
  hideHoverTip();
  if(replyText) addAIMessage(replyText);

  // 根据解释结果在图中添加说明节点与连接
  const g = currentGraph();
  try {
    const nowId = `note-${Date.now().toString(36)}`;
    if(target.type==='node'){
      const n = g.nodes.find(x=>x.id===target.id); if(!n) return;
      const desiredX = n.x + (n.w||160) + 30; const desiredY = n.y;
      const placed = placeNodeIntelligent(g, desiredX, desiredY, 160, 40, 50);
      g.nodes.push({ id: nowId, x: placed.x, y: placed.y, label: replyText.slice(0,180), name: '解释' });
      g.edges.push({ id: `e-${nowId}`, source: n.id, target: nowId, name: '解释' });
    } else {
      const e = g.edges.find(x=>x.id===target.id); if(!e) return;
      const s = g.nodes.find(x=>x.id===e.source); const t = g.nodes.find(x=>x.id===e.target); if(!s||!t) return;
      const mx = (s.x + (s.w||160) + t.x)/2; const my = (s.y + (s.h||40)/2 + t.y + (t.h||40)/2)/2;
      const placed = placeNodeIntelligent(g, mx, my, 160, 40, 50);
      g.nodes.push({ id: nowId, x: placed.x, y: placed.y, label: replyText.slice(0,180), name: '关系说明' });
      g.edges.push({ id: `e-${nowId}`, source: s.id, target: nowId, name: '说明' });
    }
    renderGraph();
  } catch {}
}

function onDoubleClickNode(n){
  const hasChild = !!state.childCanvas[n.id];
  if(hasChild){
    playTone(400, 0.5);
    switchCanvas(state.childCanvas[n.id].id, `${n.label} - 子画布`);
    state.logs.push({ts:Date.now(), op:'enter_child_canvas', nodeId:n.id});
  } else {
    playTone(1800, 0.3);
    flashNodeError(n.id);
    state.logs.push({ts:Date.now(), op:'missing_child_canvas', nodeId:n.id});
  }
}

function onDoubleClickEdge(e){
  const childMap = state.childCanvasByEdge || {};
  const cid = childMap[e.id];
  if(cid){
    playTone(420, 0.5);
    switchCanvas(cid, `边 ${e.id} - 子画布`);
    state.logs.push({ts:Date.now(), op:'enter_edge_canvas', edgeId:e.id});
  } else {
    playTone(1800, 0.3);
    const line = document.querySelector(`.edge[data-edge-id="${e.id}"]`);
    if(line){ line.classList.add('error-flash'); setTimeout(()=>line.classList.remove('error-flash'), 1000); }
    state.logs.push({ts:Date.now(), op:'missing_edge_canvas', edgeId:e.id});
  }
}

cmExplain.onclick = async ()=>{
  if(!state.contextTarget) return;
  const t = state.contextTarget;
  cm.classList.add('hidden');
  await explainTarget(t);
};
// 手动子画布已移除

function addUserMessage(text){ const sid = state.currentSessionId || 'default'; if(!state.sessionChats[sid]) state.sessionChats[sid] = []; state.sessionChats[sid].push({role:'user', content:text}); renderMessages(); }
function addAIMessage(text){ const sid = state.currentSessionId || 'default'; if(!state.sessionChats[sid]) state.sessionChats[sid] = []; state.sessionChats[sid].push({role:'assistant', content:text}); renderMessages(); }

sendBtn.onclick = async ()=>{
  const text = inputEl.value.trim(); if(!text) return; inputEl.value='';
  addUserMessage(text);
  await triggerAI({message:text});
};

renderGraph();
renderBreadcrumb();
renderCanvasTree();
renderOverlay();
const defaultId = genId('s'); state.sessionStore[defaultId] = { id: defaultId, title: state.sessionTitle, createdAt: Date.now(), graphs: state.graphs, childCanvas: state.childCanvas, childCanvasMap: state.childCanvasMap, canvasStack: state.canvasStack, activeCanvasId: state.activeCanvasId }; state.sessions.push({ id: defaultId, title: state.sessionTitle, createdAt: Date.now() }); state.currentSessionId=defaultId; state.sessionChats[defaultId] = []; renderSessionsList(); renderMessages();
// 初始化默认会话列表
if(sessionsListEl){ if(!state.sessions){ state.sessions=[]; } if(state.sessions.length===0){ const genId=(p)=>`${p}-${Date.now().toString(36)}-${Math.floor(Math.random()*1e6).toString(36)}`; const id=genId('s'); const createdAt=Date.now(); state.sessions.push({id, title: state.sessionTitle, createdAt}); state.sessionStore = state.sessionStore || {}; state.sessionStore[id] = { id, title: state.sessionTitle, createdAt, graphs: state.graphs, childCanvas: state.childCanvas, childCanvasMap: state.childCanvasMap, canvasStack: state.canvasStack, activeCanvasId: state.activeCanvasId }; renderSessionsListMinimal(); }
}

function renderOverlay(){
  const isChild = state.activeCanvasId!=='main';
  btnBack.classList.toggle('hidden', !isChild);
  if(!isChild){ overlayTopLeft.classList.add('hidden'); return; }
  const parentId = state.childCanvasMap[state.activeCanvasId];
  const parentNode = state.graphs.main.nodes.find(n=>n.id===parentId);
  overlayTopLeft.classList.remove('hidden');
  overlayTopLeft.innerHTML = marked.parse(`当前子画布对应节点：**${parentNode?.label||parentId}**`);
}

function centerGraph(graph, rootG){
  if(!graph.nodes.length) return;
  const xs = graph.nodes.map(n=>n.x);
  const ys = graph.nodes.map(n=>n.y);
  const ws = graph.nodes.map(n=>n.w||160);
  const hs = graph.nodes.map(n=>n.h||40);
  const minX = Math.min.apply(null, xs);
  const minY = Math.min.apply(null, ys);
  const maxX = Math.max.apply(null, xs.map((x,i)=>x+ws[i]));
  const maxY = Math.max.apply(null, ys.map((y,i)=>y+hs[i]));
  const bboxW = Math.max(1, maxX - minX);
  const bboxH = Math.max(1, maxY - minY);
  const viewW = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal.width : svg.clientWidth;
  const viewH = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.height ? svg.viewBox.baseVal.height : svg.clientHeight;
  const tx = (viewW - bboxW)/2 - minX;
  const ty = (viewH - bboxH)/2 - minY;
  state.view.tx = tx; state.view.ty = ty;
  const vp = document.getElementById('viewport'); if(vp) vp.setAttribute('transform', `translate(${state.view.tx},${state.view.ty}) scale(${state.view.scale})`);
}

btnBack.onclick = ()=>{
  if(state.canvasStack.length>1){
    state.canvasStack.pop();
    const top = state.canvasStack[state.canvasStack.length-1];
    state.activeCanvasId = top.id;
  }else{
    state.activeCanvasId = 'main';
    state.canvasStack = [{id:'main', title:'主画布'}];
  }
  renderGraph(); renderBreadcrumb(); renderCanvasTree(); renderOverlay();
};

function playTone(freq, duration){
  try {
    const ac = new (window.AudioContext||window.webkitAudioContext)();
    const osc = ac.createOscillator(); const gain = ac.createGain();
    osc.type = 'sine'; osc.frequency.value = freq; osc.connect(gain); gain.connect(ac.destination);
    gain.gain.setValueAtTime(0.001, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ac.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
    osc.start(); osc.stop(ac.currentTime + duration + 0.05);
  } catch {}
}

function flashNodeError(nodeId){
  const rect = document.querySelector(`[data-node-id="${nodeId}"]`);
  if(!rect) return;
  rect.classList.add('error-flash');
  setTimeout(()=>rect.classList.remove('error-flash'), 1000);
}

function clearSelection(){
  document.querySelectorAll('.selected').forEach(el=>el.classList.remove('selected'));
  document.querySelectorAll('.handle').forEach(el=>el.remove());
}

function selectNode(group, rect, n){
  clearSelection(); rect.classList.add('selected'); state.selected = {type:'node', id:n.id};
  const corners = [
    {x:n.x, y:n.y}, {x:n.x+(n.w||160), y:n.y},
    {x:n.x, y:n.y+(n.h||40)}, {x:n.x+(n.w||160), y:n.y+(n.h||40)}
  ];
  corners.forEach((c,idx)=>{
    const h = document.createElementNS('http://www.w3.org/2000/svg','rect');
    h.setAttribute('x', c.x-4); h.setAttribute('y', c.y-4); h.setAttribute('width', 8); h.setAttribute('height', 8);
    h.classList.add('handle'); h.dataset.handle = idx;
    h.addEventListener('mousedown', startResize.bind(null, rect, n, idx));
    group.appendChild(h);
  });
  state.multiSelected = [n.id];
}

function selectEdge(line){ clearSelection(); line.classList.add('selected'); state.selected = {type:'edge', id: line.dataset.edgeId}; }

let resizing = null;
function startResize(rect, n, idx){ resizing = {rect, n, idx}; }
svg.addEventListener('mousemove', (ev)=>{
  if(!resizing) return;
  const {rect, n, idx} = resizing;
  const x = ev.offsetX, y = ev.offsetY;
  let w = n.w||160, h = n.h||40;
  if(idx===1||idx===3) w = Math.max(80, x - n.x);
  if(idx===2||idx===3) h = Math.max(28, y - n.y);
  n.w = w; n.h = h; rect.setAttribute('width', w); rect.setAttribute('height', h);
});
svg.addEventListener('mouseup', ()=>{ resizing=null; });

// 节点拖拽与位置历史
let dragging = null;
function startDragNode(ev, n, rect){ dragging = { n, rect, dx: ev.offsetX - n.x, dy: ev.offsetY - n.y }; }
svg.addEventListener('mousemove', (ev)=>{
  if(!dragging) return;
  const { n, rect, dx, dy } = dragging;
  n.x = ev.offsetX - dx; n.y = ev.offsetY - dy;
  rect.setAttribute('x', n.x); rect.setAttribute('y', n.y);
});
svg.addEventListener('mouseup', ()=>{ if(dragging){ const { n } = dragging; n.posHistory = (n.posHistory||[]).concat([{x:n.x,y:n.y,ts:Date.now()}]); n.lockedPos = true; dragging=null; } });

// ===== AI 编排层 =====
async function triggerAI({message}){
  const payload = buildAIPayload(message);
  let result = null;
  try {
    result = await callAI(payload);
  } catch {
    result = await mockAI(payload);
  }
  if(result && result.reply){ addAIMessage(result.reply); }
  if(result && Array.isArray(result.ops)){ applyOps(result.ops, payload); renderGraph(); await refreshGraphFromServer(payload); }
}

function buildAIPayload(message){
  const graph = currentGraph();
  const selectionIds = state.multiSelected && state.multiSelected.length>0 ? state.multiSelected : (state.selected ? [state.selected.id] : []);
  return {
    sessionId: state.sessionId,
    activeCanvasId: state.activeCanvasId,
    canvasStack: state.canvasStack.slice(),
    selection: { nodes: selectionIds, edges: [] },
    graph: {
      nodes: graph.nodes.map(n=>({id:n.id,label:n.label,name:n.name,summary:n.summary,x:n.x,y:n.y,w:n.w,h:n.h})),
      edges: graph.edges.map(e=>({id:e.id,source:e.source,target:e.target,name:e.name,summary:e.summary})),
    },
    message,
  };
}

async function callAI(payload){
  const res = await fetch('/api/ai/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  if(!res.ok) throw new Error('api error');
  return await res.json();
}

async function mockAI(payload){
  const { message, selection, activeCanvasId } = payload;
  const selNodeId = selection.nodes && selection.nodes[0];
  const strategy = chooseCanvasStrategy(payload);
  const ops = [];
  if(/删除/.test(message) && /(你自己|自我|deepseek)/i.test(message)){
    const allNodeIds = (payload.graph?.nodes||[]).map(n=>n.id);
    const allEdgeIds = (payload.graph?.edges||[]).map(e=>e.id);
    if(allNodeIds.length) ops.push({type:'delete_nodes', ids: allNodeIds});
    if(allEdgeIds.length) ops.push({type:'delete_edges', ids: allEdgeIds});
    ops.push({type:'add_nodes', nodes:[{id:'ds-root', label:'DeepSeek 大模型', name:'DeepSeek', summary:'通用对话与图编排能力'}]});
    ops.push({type:'add_nodes', attachTo:'ds-root', nodes:[
      {id:'ds-cap', label:'模型能力', name:'能力', summary:'推理、生成、多轮对话'},
      {id:'ds-api', label:'API', name:'API', summary:'REST/SSE流式输出'},
      {id:'ds-rate', label:'速率限制', name:'限速', summary:'QPS与配额管理'},
      {id:'ds-safety', label:'安全与合规', name:'安全', summary:'鉴权与审计'},
      {id:'ds-context', label:'上下文窗口', name:'上下文', summary:'长上下文与工具调用'},
    ]});
    ops.push({type:'add_edges', edges:[
      {id:'e-ds-cap', source:'ds-root', target:'ds-cap', name:'包含', summary:'DeepSeek 包含核心能力'},
      {id:'e-ds-api', source:'ds-root', target:'ds-api', name:'提供', summary:'提供标准API'},
      {id:'e-ds-rate', source:'ds-root', target:'ds-rate', name:'策略', summary:'配额与限速策略'},
      {id:'e-ds-safety', source:'ds-root', target:'ds-safety', name:'保障', summary:'安全与合规'},
      {id:'e-ds-context', source:'ds-root', target:'ds-context', name:'特性', summary:'上下文与工具集成'},
    ]});
  }
  if(/计算机|computer/i.test(message) && activeCanvasId==='main'){
    const rootId = selNodeId || 'n1';
    const newNodes = [
      {id:'mem', label:'内存', name:'内存', summary:'用于暂存数据和指令。'},
      {id:'storage', label:'存储', name:'存储', summary:'长期保存数据的设备。'},
      {id:'io-in', label:'输入设备', name:'输入设备', summary:'键盘、鼠标等。'},
      {id:'io-out', label:'输出设备', name:'输出设备', summary:'显示器、打印机等。'},
    ];
    ops.push({type:'add_nodes', nodes:newNodes, attachTo:rootId});
    ops.push({type:'add_edges', edges:[
      {id:'e-mem', source:rootId, target:'mem', name:'包含', summary:'计算机包含内存。'},
      {id:'e-sto', source:rootId, target:'storage', name:'包含', summary:'计算机包含存储。'},
      {id:'e-ioi', source:rootId, target:'io-in', name:'交互', summary:'输入到计算机。'},
      {id:'e-ioo', source:rootId, target:'io-out', name:'交互', summary:'计算机输出到外部。'},
    ]});
  }
  if(/CPU|中央处理器/i.test(message)){
    if(strategy.mode==='child' && selNodeId){
      const childId = 'c-'+selNodeId;
      ops.push({type:'create_child_canvas', nodeId: selNodeId, canvasId: childId, title: `${payload.graph.nodes.find(n=>n.id===selNodeId)?.label||selNodeId} - 子画布`});
      ops.push({type:'add_nodes', targetCanvas: childId, nodes:[
        {id: selNodeId+'-core', label:'内核', name:'内核', summary:'执行指令与控制。', x:300, y:200},
        {id: selNodeId+'-cache', label:'缓存', name:'缓存', summary:'加速数据访问。', x:520, y:200},
        {id: selNodeId+'-alu', label:'算术逻辑单元', name:'ALU', summary:'进行算术逻辑运算。', x:300, y:320},
      ], edges:[]});
      ops.push({type:'add_edges', edges:[
        {id: 'e-'+selNodeId+'-core-alu', source: selNodeId+'-core', target: selNodeId+'-alu', name:'执行', summary:'内核驱动ALU进行运算'},
        {id: 'e-'+selNodeId+'-core-cache', source: selNodeId+'-core', target: selNodeId+'-cache', name:'协同', summary:'内核与缓存协同提升访问速度'},
      ]});
    } else {
      const rootId = selNodeId || 'n4';
      ops.push({type:'add_nodes', nodes:[
        {id:'cache', label:'缓存', name:'缓存', summary:'加速数据访问。'},
        {id:'core', label:'内核', name:'内核', summary:'执行指令与控制。'},
      ]});
      ops.push({type:'add_edges', edges:[
        {id:'e-cache', source:rootId, target:'cache', name:'组成', summary:'CPU 包含缓存。'},
        {id:'e-core', source:rootId, target:'core', name:'组成', summary:'CPU 包含内核。'},
      ]});
    }
  }
  const reply = buildReplyText(payload, ops);
  return { reply, ops };
}

function chooseCanvasStrategy(payload){
  const g = payload.graph;
  const selId = payload.selection.nodes && payload.selection.nodes[0];
  const neighbors = selId ? getNeighbors(g, selId) : [];
  const dense = (g.nodes.length >= 12) || (neighbors.length >= 5);
  const related = /CPU|中央处理器/i.test(payload.message) && selId && /CPU|中央处理器/i.test(g.nodes.find(n=>n.id===selId)?.label||'');
  if(dense || (!related && selId)) return {mode:'child', nodeId: selId};
  return {mode:'main'};
}

function getNeighbors(graph, nodeId){
  const ids = new Set();
  graph.edges.forEach(e=>{ if(e.source===nodeId) ids.add(e.target); if(e.target===nodeId) ids.add(e.source); });
  return Array.from(ids);
}

function applyOps(ops, payload){
  const targetCanvasId = ops.find(o=>o.type==='create_child_canvas')?.canvasId;
  if(targetCanvasId){
    const nodeId = ops.find(o=>o.type==='create_child_canvas').nodeId;
    state.childCanvas[nodeId] = { id: targetCanvasId, title: ops.find(o=>o.type==='create_child_canvas').title, nodes: [], edges: [] };
    state.childCanvasMap[targetCanvasId] = nodeId;
    switchCanvas(targetCanvasId, state.childCanvas[nodeId].title);
  }
  const graph = currentGraph();
  ops.forEach(op=>{
    if(op.type==='add_nodes'){
      const attachTo = op.attachTo;
      const base = attachTo ? graph.nodes.find(n=>n.id===attachTo) : null;
      op.nodes.forEach((n, idx)=>{
        const id = n.id || ('u'+Math.floor(Math.random()*100000));
        const desiredX = n.x!=null ? n.x : (base ? base.x + ((base.w||160)+40) + (idx*40) : 200+Math.random()*700);
        const desiredY = n.y!=null ? n.y : (base ? base.y + (idx*60) : 100+Math.random()*500);
        const placed = placeNodeIntelligent(graph, desiredX, desiredY, 160, 40, 50);
        graph.nodes.push({ id, x: placed.x, y: placed.y, label: n.label||n.name||id, name:n.name, summary:n.summary, posHistory:[{x:placed.x,y:placed.y,ts:Date.now()}] });
      });
    }
    if(op.type==='add_edges'){
      op.edges.forEach(e=>{
        const id = e.id || ('e'+Math.floor(Math.random()*100000));
        graph.edges.push({ id, source:e.source, target:e.target, name:e.name, summary:e.summary });
      });
    }
    if(op.type==='update_node'){
      const n = graph.nodes.find(nn=>nn.id===op.id); if(!n) return;
      if(op.label) n.label = op.label;
      if(op.name) n.name = op.name;
      if(op.summary) n.summary = op.summary;
    }
    if(op.type==='update_edge'){
      const e = graph.edges.find(ee=>ee.id===op.id); if(!e) return;
      if(op.name) e.name = op.name;
      if(op.summary) e.summary = op.summary;
    }
  });
  state.logs.push({ts:Date.now(), op:'apply_ops', count:ops.length});
}
async function refreshGraphFromServer(payload){
  try{
    const res = await fetch('/api/session/canvas', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ sessionId: payload.sessionId, activeCanvasId: state.activeCanvasId }) });
    if(!res.ok) return;
    const data = await res.json();
    const nodes = data.nodes||[], edges = data.edges||[];
    if(state.activeCanvasId==='main'){
      state.graphs.main.nodes = nodes; state.graphs.main.edges = edges;
    } else {
      const pid = state.childCanvasMap[state.activeCanvasId];
      if(pid && state.childCanvas[pid]){ state.childCanvas[pid].nodes = nodes; state.childCanvas[pid].edges = edges; }
    }
    renderGraph();
  }catch{}
}
// 碰撞检测与智能布局
function nodeRect(n){ return { x:n.x, y:n.y, w:n.w||160, h:n.h||40 }; }
function rectsOverlap(a,b,gap){ return !(a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y); }
function findNonOverlap(graph, x, y, w, h, gap){
  const candidates = [];
  const rings = [0,20,40,60,80,100,140,180];
  rings.forEach(r=>{ for(let ang=0; ang<360; ang+=30){ candidates.push({x:x+Math.cos(ang*Math.PI/180)*r, y:y+Math.sin(ang*Math.PI/180)*r}); } });
  for(const c of candidates){ const rect={x:c.x,y:c.y,w,h}; const collide = graph.nodes.some(n=>rectsOverlap(rect, nodeRect(n), gap)); if(!collide) return c; }
  return null;
}
function forcePlace(graph, x, y){ let px=x, py=y; const k=100; for(let i=0;i<20;i++){ graph.nodes.forEach(n=>{ const dx=px-(n.x+(n.w||160)/2), dy=py-(n.y+(n.h||40)/2); const d=Math.max(1, Math.hypot(dx,dy)); const f=k/(d*d); px += (dx/d)*f; py += (dy/d)*f; }); } return {x:px,y:py}; }
function gridPlace(graph, w, h, gap){ const sx=80, sy=80, stepx=w+gap, stepy=h+gap; for(let r=0;r<60;r++){ for(let c=0;c<60;c++){ const x=sx+c*stepx, y=sy+r*stepy; const rect={x,y,w,h}; const collide=graph.nodes.some(n=>rectsOverlap(rect,nodeRect(n),gap)); if(!collide) return {x,y}; } } return {x:sx,y:sy}; }
function placeNodeIntelligent(graph, x, y, w, h, gap){ const p1=findNonOverlap(graph,x,y,w,h,gap); if(p1) return p1; const fd=forcePlace(graph,x,y); const p2=findNonOverlap(graph,fd.x,fd.y,w,h,gap); if(p2) return p2; return gridPlace(graph,w,h,gap); }
function buildReplyText(payload, ops){
  const msg = payload.message||'';
  const sel = (payload.selection && payload.selection.nodes) ? payload.selection.nodes : [];
  const graph = payload.graph || {nodes:[],edges:[]};
  const focusLabel = sel.length ? ((graph.nodes||[]).find(n=>n.id===sel[0])?.label||sel[0]) : '';
  let intro = '';
  if(/删除/.test(msg) && /(你自己|自我|deepseek)/i.test(msg)){
    intro = `我是 DeepSeek 大模型，支持通用对话、推理与可视化编排。为了更好地介绍自己，我先清理当前画布，并以图的方式展示我的结构。`;
  } else 
  if(/CPU|中央处理器/i.test(msg)){
    intro = `CPU 是计算机的核心，负责从内存取指、解码并由算术逻辑单元执行，同时通过控制单元协调寄存器与缓存的读写。`;
    if(focusLabel) intro += ` 本次以 ${focusLabel} 为焦点逐步展开其结构。`;
  } else if(/计算机|computer/i.test(msg)){
    intro = `计算机由硬件与软件协作完成信息处理：硬件提供算力与存储，软件封装算法与应用以驱动硬件。`;
    if(focusLabel) intro += ` 这次以 ${focusLabel} 为锚点补全相关组成。`;
  } else {
    intro = `好的，已理解你的问题：${msg}。先给出简要说明，同时我会在图上做适度补充。`;
  }
  const addedNodes = [];
  const addedEdges = [];
  let childCanvas = '';
  let deletedCount = 0;
  ops.forEach(op=>{
    if(op.type==='add_nodes'){ (op.nodes||[]).forEach(n=>addedNodes.push(n.label||n.name||n.id)); }
    if(op.type==='add_edges'){ (op.edges||[]).forEach(e=>addedEdges.push(e.id||`${e.source}->${e.target}`)); }
    if(op.type==='create_child_canvas'){ childCanvas = op.canvasId; }
    if(op.type==='delete_nodes'){ deletedCount += (op.ids||[]).length; }
  });
  const changes = [];
  if(deletedCount) changes.push(`清理旧内容 ${deletedCount} 个元素`);
  if(childCanvas) changes.push('展开子画布以聚焦细节');
  if(addedNodes.length) changes.push(`新增节点：${addedNodes.slice(0,6).join('、')}${addedNodes.length>6?' 等':''}`);
  if(addedEdges.length) changes.push(`补充连接 ${addedEdges.length} 条`);
  const side = changes.length ? `顺便我也在当前${payload.activeCanvasId==='main'?'主画布':'子画布'}中${changes.join('，')}，方便你继续探索。` : `当前图无需改动，我将以文字解释为主。`;
  return `${intro}\n\n${side}`;
}
let currentCanvasLi = null; let currentCanvasId = null;
function openCanvasMenu(px, py, liEl, canvasId){
  currentCanvasLi = liEl; currentCanvasId = canvasId;
  canvasMenu.classList.remove('hidden');
  const sidebar = document.querySelector('.sidebar');
  const sRect = sidebar.getBoundingClientRect();
  const mRect = canvasMenu.getBoundingClientRect();
  let x = px - sRect.left - window.scrollX;
  let y = py - sRect.top - window.scrollY;
  x = Math.max(8, Math.min(x, sRect.width - mRect.width - 8));
  y = Math.max(8, Math.min(y, sRect.height - mRect.height - 8));
  canvasMenu.style.left = x + 'px';
  canvasMenu.style.top = y + 'px';
}

cmCanvasRename.addEventListener('click', ()=>{
  canvasMenu.classList.add('hidden'); if(!currentCanvasLi) return;
  const input = document.createElement('input'); input.type='text'; input.value=currentCanvasLi.textContent.trim();
  input.style.border='1px solid var(--line)'; input.style.borderRadius='6px'; input.style.padding='4px 6px';
  currentCanvasLi.replaceChildren(input); input.focus();
  const commit = ()=>{ const val = input.value.trim(); currentCanvasLi.textContent = val || currentCanvasLi.textContent; };
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ commit(); } if(e.key==='Escape'){ currentCanvasLi.textContent = currentCanvasLi.textContent; } });
  input.addEventListener('blur', commit);
});

cmCanvasDelete.addEventListener('click', ()=>{
  canvasMenu.classList.add('hidden');
  if(!currentCanvasId) return;
  if(!confirm('确认删除该画布内容？')) return;
  if(currentCanvasId==='main'){
    state.graphs.main.nodes = []; state.graphs.main.edges = []; state.childCanvas = {}; state.childCanvasMap = {};
    renderGraph();
  }
});

// ========== 视角控制：中键拖动与滚轮缩放（含惯性与缓动） ==========
function applyViewport(){ const vp = document.getElementById('viewport'); if(vp) vp.setAttribute('transform', `translate(${state.view.tx},${state.view.ty}) scale(${state.view.scale})`); }

let pan = { active:false, sx:0, sy:0, stx:0, sty:0, vx:0, vy:0, lastX:0, lastY:0, lastDown:0 };
svg.addEventListener('mousedown', (ev)=>{
  if(ev.button===1){ ev.preventDefault(); pan.active=true; pan.sx=ev.clientX; pan.sy=ev.clientY; pan.stx=state.view.tx; pan.sty=state.view.ty; pan.lastX=ev.clientX; pan.lastY=ev.clientY; const now=Date.now(); if(now-pan.lastDown<300){ state.view.tx=0; state.view.ty=0; state.view.scale=1; applyViewport(); } pan.lastDown=now; }
});
svg.addEventListener('mousemove', (ev)=>{
  if(!pan.active) return;
  const dx = ev.clientX - pan.sx; const dy = ev.clientY - pan.sy;
  state.view.tx = pan.stx + dx; state.view.ty = pan.sty + dy;
  pan.vx = ev.clientX - pan.lastX; pan.vy = ev.clientY - pan.lastY; pan.lastX = ev.clientX; pan.lastY = ev.clientY;
  applyViewport();
});
svg.addEventListener('mouseup', ()=>{
  if(!pan.active) return; pan.active=false;
  let vx = pan.vx, vy = pan.vy; const decay = 0.92; const stop = 0.5;
  function step(){ vx*=decay; vy*=decay; if(Math.abs(vx)<stop && Math.abs(vy)<stop) return; state.view.tx += vx; state.view.ty += vy; applyViewport(); requestAnimationFrame(step); }
  requestAnimationFrame(step);
});

let zoomAnimToken = 0;
svg.addEventListener('wheel', (ev)=>{
  ev.preventDefault();
  const rect = svg.getBoundingClientRect();
  const cx = rect.left + rect.width / 2; const cy = rect.top + rect.height / 2;
  const center = toSvgClient(cx, cy);
  const s0 = state.view.scale; const tx0 = state.view.tx; const ty0 = state.view.ty;
  const factor = Math.exp(-ev.deltaY * 0.0006); // 进一步降低速度
  let s1 = Math.max(0.1, Math.min(10, s0*factor));
  const duration = 240; const t0 = performance.now();
  function easeOutCubic(t){ t = Math.min(1, Math.max(0,t)); return 1-Math.pow(1-t,3); }
  pan.active = false; pan.vx = 0; pan.vy = 0; // 缩放期间禁用拖拽惯性
  const token = ++zoomAnimToken;
  (function animate(){
    if(token !== zoomAnimToken) return; // 取消旧动画
    const now = performance.now();
    const p = (now - t0) / duration; const k = easeOutCubic(p);
    const s = s0 + (s1 - s0) * k;
    state.view.tx = center.x - (s/s0) * (center.x - tx0);
    state.view.ty = center.y - (s/s0) * (center.y - ty0);
    state.view.scale = s; applyViewport();
    if(p < 1) requestAnimationFrame(animate);
  })();
}, { passive:false });
