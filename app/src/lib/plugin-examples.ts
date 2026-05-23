import type { PluginKindDescriptor } from '../state/plugin-registry-store';

export type ExamplePlugin = {
  descriptor: PluginKindDescriptor;
};

// ---------------------------------------------------------------------------
// Mermaid Diagram
// Loads mermaid@10 from CDN, renders a diagram from window.opencanvas.props.chart
// Note: mermaid.render() returns SVG text which we set via the mermaid API's
// own container — we use a scratch element whose id is managed by mermaid
// itself. The result is then moved into our container via appendChild.
// ---------------------------------------------------------------------------
const MERMAID_SRCDOC = `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;background:transparent;color:#fafafa;font-family:'Inter',system-ui,sans-serif}
#root{width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:auto;padding:12px}
.empty{color:#a1a1aa;font-size:12px;padding:24px;text-align:center;line-height:1.5}
.empty .ck{background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:4px;color:#ddd6fe;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px}
.error{color:#fca5a5;font-size:11px;padding:18px;font-family:'JetBrains Mono',ui-monospace,monospace;white-space:pre-wrap;overflow:auto}
</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head><body>
<div id="root"></div>
<script>
(function(){
mermaid.initialize({startOnLoad:false,theme:'dark',themeVariables:{primaryColor:'#a78bfa',primaryTextColor:'#fafafa',primaryBorderColor:'rgba(255,255,255,0.18)',lineColor:'#a1a1aa',background:'transparent',mainBkg:'rgba(255,255,255,0.06)',nodeBorder:'rgba(255,255,255,0.18)',clusterBkg:'rgba(255,255,255,0.03)',titleColor:'#fafafa',edgeLabelBackground:'rgba(10,10,13,0.8)',tertiaryColor:'rgba(255,255,255,0.04)'}});
var container=document.getElementById('root');
var renderCount=0;
function clear(node){while(node.firstChild)node.removeChild(node.firstChild);}
function showEmpty(){
  clear(container);
  var d=document.createElement('div');d.className='empty';
  var t1=document.createTextNode('No chart yet — pass ');
  var code=document.createElement('span');code.className='ck';code.textContent='{chart}';
  var t2=document.createTextNode(' as the widget prop.');
  d.appendChild(t1);d.appendChild(code);d.appendChild(t2);
  container.appendChild(d);
}
function showError(msg){clear(container);var p=document.createElement('pre');p.className='error';p.textContent=String(msg);container.appendChild(p);}
function render(chart){
  if(!chart||!chart.trim()){showEmpty();return;}
  renderCount++;
  var svgId='mermaid-svg-'+renderCount;
  mermaid.render(svgId,chart).then(function(result){
    clear(container);
    var tmp=document.createElement('div');
    tmp.style.cssText='max-width:100%;max-height:100%;display:flex;align-items:center;justify-content:center';
    var parser=new DOMParser();
    var doc=parser.parseFromString(result.svg,'image/svg+xml');
    var svgEl=doc.documentElement;
    svgEl.setAttribute('style','max-width:100%;height:auto');
    container.appendChild(tmp);
    tmp.appendChild(document.adoptNode(svgEl));
  }).catch(function(e){showError(e.message||e);});
}
function readChart(){var p=window.opencanvas&&window.opencanvas.props;return p&&p.chart;}
render(readChart());
document.addEventListener('opencanvas:props',function(e){render(e.detail&&e.detail.chart);});
})();
</script></body></html>`;

// ---------------------------------------------------------------------------
// QR Code
// Loads qrcode from CDN, renders a QR code canvas from window.opencanvas.props.data
// ---------------------------------------------------------------------------
const QRCODE_SRCDOC = `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;background:transparent;color:#fafafa;font-family:'Inter',system-ui,sans-serif}
#root{width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:12px}
.empty{color:#a1a1aa;font-size:12px;padding:24px;text-align:center;line-height:1.5}
.empty .ck{background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:4px;color:#ddd6fe;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px}
</style>
<script src="https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js"></script>
</head><body>
<div id="root"></div>
<script>
(function(){
var container=document.getElementById('root');
function clear(node){while(node.firstChild)node.removeChild(node.firstChild);}
function showEmpty(){
  clear(container);
  var d=document.createElement('div');d.className='empty';
  var t1=document.createTextNode('No data yet — pass ');
  var code=document.createElement('span');code.className='ck';code.textContent='{data}';
  var t2=document.createTextNode(' as the widget prop.');
  d.appendChild(t1);d.appendChild(code);d.appendChild(t2);
  container.appendChild(d);
}
function render(data){
  if(!data||!String(data).trim()){showEmpty();return;}
  var size=Math.min(container.clientWidth||200,container.clientHeight||200,200);
  var canvas=document.createElement('canvas');
  canvas.style.cssText='max-width:100%;max-height:100%;object-fit:contain';
  QRCode.toCanvas(canvas,String(data),{
    width:size,
    margin:1,
    color:{dark:'#fafafa',light:'#00000000'}
  },function(err){
    if(err){
      clear(container);
      var p=document.createElement('pre');
      p.style.cssText='color:#fca5a5;font-size:11px;padding:18px;font-family:monospace;white-space:pre-wrap;overflow:auto';
      p.textContent=String(err);
      container.appendChild(p);
      return;
    }
    clear(container);
    container.appendChild(canvas);
  });
}
function readData(){var p=window.opencanvas&&window.opencanvas.props;return p&&p.data;}
render(readData());
document.addEventListener('opencanvas:props',function(e){render(e.detail&&e.detail.data);});
})();
</script></body></html>`;


// ---------------------------------------------------------------------------
// Python REPL
// Loads pyodide from CDN, provides an editable Python cell with Run button.
// Captures stdout via pyodide.setStdout, shows return value repr and errors.
// ---------------------------------------------------------------------------
const PYTHON_REPL_SRCDOC = `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;background:transparent;color:#fafafa;font-family:'Inter',system-ui,sans-serif}
body{padding:12px;display:flex;flex-direction:column;gap:8px;overflow:hidden}
textarea{
  flex:1;min-height:0;width:100%;resize:none;
  background:rgba(255,255,255,0.04);color:#fafafa;
  border:1px solid rgba(255,255,255,0.12);border-radius:6px;
  padding:10px;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:13px;
  line-height:1.5;outline:none;tab-size:4;overflow-y:auto;
}
textarea:focus{border-color:rgba(167,139,250,0.5);}
.toolbar{display:flex;align-items:center;gap:8px;flex-shrink:0}
button#run{
  background:#a78bfa;color:#0a0a0d;border:none;border-radius:6px;
  padding:6px 12px;font-size:13px;font-weight:600;cursor:pointer;
  transition:background 0.15s;
}
button#run:hover:not(:disabled){background:#c4b5fd;}
button#run:disabled{opacity:0.5;cursor:not-allowed;}
.status{font-size:12px;color:#a1a1aa;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.output{
  flex-shrink:0;max-height:120px;overflow-y:auto;
  background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);
  border-radius:6px;padding:10px;
  font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;
  white-space:pre-wrap;line-height:1.5;color:#fafafa;
}
.output:empty::before{content:'Output appears here…';color:#52525b;}
.output .err{color:#fca5a5;}
.output .info{color:#a1a1aa;}
</style>
</head><body>
<textarea id="ed" spellcheck="false"></textarea>
<div class="toolbar">
  <button id="run" disabled>Loading…</button>
  <span class="status" id="status">Loading Python (first run may take ~10s)…</span>
</div>
<div class="output" id="out"></div>
<script>
(function(){
var DEFAULT_CODE='# Python code here\nprint("hello")';
var ed=document.getElementById('ed');
var btn=document.getElementById('run');
var statusEl=document.getElementById('status');
var outEl=document.getElementById('out');
var pyodide=null;
var stdoutBuf='';

function readCode(){
  var p=window.opencanvas&&window.opencanvas.props;
  return (p&&typeof p.code==='string'&&p.code)||DEFAULT_CODE;
}
ed.value=readCode();

function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setStatus(msg){statusEl.textContent=msg;}

(function loadPyodide(){
  var s=document.createElement('script');
  s.src='https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.js';
  s.onload=function(){
    window.loadPyodide().then(function(py){
      pyodide=py;
      pyodide.setStdout({batched:function(text){stdoutBuf+=text+'\n';}});
      pyodide.setStderr({batched:function(text){stdoutBuf+='[stderr] '+text+'\n';}});
      btn.disabled=false;
      btn.textContent='Run';
      setStatus('Python ready');
    }).catch(function(e){
      setStatus('Failed to load Python: '+String(e));
    });
  };
  s.onerror=function(){setStatus('Failed to load pyodide from CDN.');};
  document.head.appendChild(s);
})();

btn.addEventListener('click',function(){
  if(!pyodide){return;}
  outEl.innerHTML='';
  stdoutBuf='';
  var code=ed.value;
  btn.disabled=true;
  btn.textContent='Running…';
  setStatus('');
  try{
    var result=pyodide.runPython(code);
    var outHtml='';
    if(stdoutBuf){outHtml+=escHtml(stdoutBuf);}
    if(result!==undefined&&result!==null){
      var repr=String(result);
      try{
        var pyRepr=pyodide.globals.get('repr');
        if(pyRepr){repr=pyRepr(result);if(pyRepr.destroy)pyRepr.destroy();}
      }catch(e){}
      outHtml+='<span class="info">=> '+escHtml(repr)+'</span>';
    }
    if(!outHtml){outHtml='<span class="info">(no output)</span>';}
    outEl.innerHTML=outHtml;
    setStatus('Done');
  }catch(e){
    var msg=String(e);
    outEl.innerHTML='<span class="err">'+escHtml(msg)+'</span>';
    setStatus('Error');
  }finally{
    btn.disabled=false;
    btn.textContent='Run';
  }
});

document.addEventListener('opencanvas:props',function(e){
  var code=e.detail&&typeof e.detail.code==='string'?e.detail.code:null;
  if(code!==null){ed.value=code;}
});

ed.addEventListener('keydown',function(e){
  if(e.key==='Tab'){
    e.preventDefault();
    var s=ed.selectionStart,end=ed.selectionEnd;
    ed.value=ed.value.substring(0,s)+'    '+ed.value.substring(end);
    ed.selectionStart=ed.selectionEnd=s+4;
  }
});
})();
</script></body></html>`;

// ---------------------------------------------------------------------------
// JavaScript REPL
// No external lib. eval()s the editor content in a sandboxed IIFE,
// captures console.log/info/warn/error during execution, shows result.
// ---------------------------------------------------------------------------
const JS_REPL_SRCDOC = `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;background:transparent;color:#fafafa;font-family:'Inter',system-ui,sans-serif}
body{padding:12px;display:flex;flex-direction:column;gap:8px;overflow:hidden}
textarea{
  flex:1;min-height:0;width:100%;resize:none;
  background:rgba(255,255,255,0.04);color:#fafafa;
  border:1px solid rgba(255,255,255,0.12);border-radius:6px;
  padding:10px;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:13px;
  line-height:1.5;outline:none;tab-size:4;overflow-y:auto;
}
textarea:focus{border-color:rgba(167,139,250,0.5);}
.toolbar{display:flex;align-items:center;gap:8px;flex-shrink:0}
button#run{
  background:#a78bfa;color:#0a0a0d;border:none;border-radius:6px;
  padding:6px 12px;font-size:13px;font-weight:600;cursor:pointer;
  transition:background 0.15s;
}
button#run:hover{background:#c4b5fd;}
.output{
  flex-shrink:0;max-height:120px;overflow-y:auto;
  background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);
  border-radius:6px;padding:10px;
  font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;
  white-space:pre-wrap;line-height:1.5;color:#fafafa;
}
.output:empty::before{content:'Output appears here…';color:#52525b;}
.output .err{color:#fca5a5;}
.output .warn{color:#fde68a;}
.output .info{color:#a1a1aa;}
</style>
</head><body>
<textarea id="ed" spellcheck="false"></textarea>
<div class="toolbar">
  <button id="run">Run</button>
</div>
<div class="output" id="out"></div>
<script>
(function(){
var DEFAULT_CODE="// JS code here\nconsole.log('hello')";
var ed=document.getElementById('ed');
var btn=document.getElementById('run');
var outEl=document.getElementById('out');

function readCode(){
  var p=window.opencanvas&&window.opencanvas.props;
  return (p&&typeof p.code==='string'&&p.code)||DEFAULT_CODE;
}
ed.value=readCode();

function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fmtArgs(args){
  return Array.from(args).map(function(a){
    try{return typeof a==='object'&&a!==null?JSON.stringify(a,null,2):String(a);}
    catch(e){return String(a);}
  }).join(' ');
}

btn.addEventListener('click',function(){
  outEl.innerHTML='';
  var lines=[];
  var origLog=console.log,origInfo=console.info,origWarn=console.warn,origError=console.error;
  console.log=function(){lines.push({t:'log',m:fmtArgs(arguments)});};
  console.info=function(){lines.push({t:'info',m:fmtArgs(arguments)});};
  console.warn=function(){lines.push({t:'warn',m:fmtArgs(arguments)});};
  console.error=function(){lines.push({t:'err',m:fmtArgs(arguments)});};
  var result,hasResult=false,errMsg=null;
  try{
    result=(0,eval)('(function(){"use strict";'+ed.value+'\n})()');
    hasResult=true;
  }catch(e){
    errMsg=e instanceof Error
      ?(e.name+': '+e.message+(e.stack?'\n'+e.stack.split('\n').slice(1,4).join('\n'):''))
      :String(e);
  }finally{
    console.log=origLog;console.info=origInfo;console.warn=origWarn;console.error=origError;
  }
  var html='';
  lines.forEach(function(l){
    var cls=l.t==='warn'?'warn':l.t==='err'?'err':l.t==='info'?'info':'';
    html+=(cls?'<span class="'+cls+'">':'')+escHtml(l.m)+(cls?'</span>':'')+'\n';
  });
  if(errMsg){
    html+='<span class="err">'+escHtml(errMsg)+'</span>';
  }else if(hasResult&&result!==undefined){
    var repr;
    try{repr=typeof result==='object'&&result!==null?JSON.stringify(result,null,2):String(result);}
    catch(e){repr=String(result);}
    html+='<span class="info">=> '+escHtml(repr)+'</span>';
  }
  if(!html){html='<span class="info">(no output)</span>';}
  outEl.innerHTML=html;
});

document.addEventListener('opencanvas:props',function(e){
  var code=e.detail&&typeof e.detail.code==='string'?e.detail.code:null;
  if(code!==null){ed.value=code;}
});

ed.addEventListener('keydown',function(e){
  if(e.key==='Tab'){
    e.preventDefault();
    var s=ed.selectionStart,end=ed.selectionEnd;
    ed.value=ed.value.substring(0,s)+'    '+ed.value.substring(end);
    ed.selectionStart=ed.selectionEnd=s+4;
  }
});
})();
</script></body></html>`;

export const EXAMPLE_PLUGINS: ExamplePlugin[] = [
  {
    descriptor: {
      kind: 'mermaid',
      label: 'Mermaid Diagram',
      description:
        'Render flowcharts, sequence diagrams, gantt, class, ER, and more from Mermaid syntax. Pass {chart} as the prop.',
      renderer: {
        type: 'iframe',
        srcdoc: MERMAID_SRCDOC,
        sandbox: 'allow-scripts',
        defaultSize: { w: 480, h: 360 },
      },
    },
  },
  {
    descriptor: {
      kind: 'qrcode',
      label: 'QR Code',
      description:
        'Generate a QR code from any text or URL. Pass {data} as the prop. Renders on canvas, scales to widget size.',
      renderer: {
        type: 'iframe',
        srcdoc: QRCODE_SRCDOC,
        sandbox: 'allow-scripts',
        defaultSize: { w: 240, h: 240 },
      },
    },
  },
  {
    descriptor: {
      kind: 'python-repl',
      label: 'Python REPL',
      description:
        'Run Python code directly in the browser via Pyodide. Pass {code} as the prop to pre-populate the editor. Captures stdout and shows return value repr.',
      renderer: {
        type: 'iframe',
        srcdoc: PYTHON_REPL_SRCDOC,
        sandbox: 'allow-scripts',
        defaultSize: { w: 540, h: 380 },
      },
    },
  },
  {
    descriptor: {
      kind: 'js-repl',
      label: 'JavaScript REPL',
      description:
        'Run JavaScript in the browser sandbox. Pass {code} as the prop to pre-populate the editor. Captures console.log/warn/error and the return value.',
      renderer: {
        type: 'iframe',
        srcdoc: JS_REPL_SRCDOC,
        sandbox: 'allow-scripts',
        defaultSize: { w: 540, h: 320 },
      },
    },
  },
];
