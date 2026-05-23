import type { WidgetRegistry } from './widget-registry.js';

/**
 * Built-in plugin widgets registered when the WidgetRegistry is first
 * constructed. Same shape as a third-party plugin — they go through
 * the exact same code path. The advantage of registering them here
 * instead of in src/agent/types.ts as a built-in WidgetKind is that
 * the rendering surface (sandboxed iframe + postMessage prop bridge)
 * is shared with third-party plugins; iterating on the chart UI is
 * a srcdoc edit, not a tldraw shape-util refactor.
 *
 * To add another built-in: append to the array. The descriptor format
 * is the same union backing POST /v1/canvas/widget-kinds — see
 * src/backend/widget-registry.ts for the shape.
 */
export function registerBuiltinWidgets(registry: WidgetRegistry): void {
  registry.register({
    kind: 'html',
    label: 'HTML',
    description:
      'Render arbitrary HTML in a sandboxed iframe. Pass {html} as the prop — the entire HTML document or fragment to render. The HTML executes in an `allow-scripts`-only sandbox: it can run JavaScript, fetch from CDNs (e.g., Tailwind, D3, Three.js, Chart.js), and render anything visual, but cannot access localStorage, cookies, or the parent DOM. Use this for one-shot novel renders where there is no reusable template — for repeat patterns, use `register_widget_kind` first. CORS note: the sandbox gives the iframe a null origin; to fetch from APIs that reject null-origin requests (most financial/private APIs), use the backend proxy: `fetch(\'/v1/plugin-fetch?url=\' + encodeURIComponent(targetUrl))`.',
    renderer: {
      type: 'iframe',
      sandbox: 'allow-scripts',
      defaultSize: { w: 480, h: 320 },
      srcdoc: HTML_SRCDOC,
    },
  });

  registry.register({
    kind: 'chart',
    label: 'Chart',
    description:
      'Render a Vega-Lite spec. Pass {spec} (Vega-Lite v5 JSON) in the props. ' +
      'Useful for line/bar/scatter/heatmap/candlestick — anything Vega-Lite supports.',
    renderer: {
      type: 'iframe',
      sandbox: 'allow-scripts',
      defaultSize: { w: 520, h: 360 },
      srcdoc: CHART_SRCDOC,
    },
  });

  registry.register({
    kind: 'calendar',
    label: 'Calendar',
    description:
      "Render a calendar — year view (12 mini-months, 4×3 grid) or month view (single full-width month with day-of-week header). Pass {view, year, month, events?, title?}.\n" +
      "- view: 'year' or 'month' (default 'month')\n" +
      '- year: full 4-digit year (default current)\n' +
      "- month: 1–12 (only used when view='month'; default current)\n" +
      "- events: array of {date: 'YYYY-MM-DD', label?: string} — rendered as dots on year view or chips on month view\n" +
      '- title: optional caption above the grid\n\n' +
      'Use this when the user asks to see a calendar, plan dates, or visualize event timing across days/months. Today’s date is auto-highlighted.',
    renderer: {
      type: 'iframe',
      sandbox: 'allow-scripts',
      defaultSize: { w: 540, h: 420 },
      srcdoc: CALENDAR_SRCDOC,
    },
  });
}

/**
 * HTML widget renderer template.
 *
 * A thin shim that takes `window.opencanvas.props.html` and renders it
 * inside a NESTED sandboxed iframe (srcdoc=props.html). The nested iframe
 * inherits the outer sandbox = `allow-scripts` only, with no
 * `allow-same-origin` — so user-supplied HTML cannot access the parent
 * iframe's DOM, localStorage, or cookies. This double-sandboxing is the
 * standard pattern for safely rendering user-supplied HTML.
 *
 * Shows a friendly empty state when the `html` prop is absent.
 */
const HTML_SRCDOC = `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;background:transparent;color:#fafafa;font-family:'Inter',system-ui,sans-serif}
#wrap{height:100%;width:100%;display:flex;align-items:stretch;justify-content:stretch}
.empty{color:#a1a1aa;font-size:12px;padding:24px;text-align:center;line-height:1.5}
.empty .ck{background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:4px;color:#ddd6fe;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px}
</style></head>
<body>
<div id="wrap"></div>
<script>
(function(){
  var wrap = document.getElementById('wrap');
  var currentFrame = null;
  var currentEmpty = null;
  function clearWrap(){
    while(wrap.firstChild)wrap.removeChild(wrap.firstChild);
    currentFrame = null;
    currentEmpty = null;
  }
  function render(props){
    var html = props && typeof props.html === 'string' ? props.html : '';
    if (!html) {
      clearWrap();
      var d = document.createElement('div');
      d.className = 'empty';
      d.appendChild(document.createTextNode('No html prop yet — pass '));
      var ck = document.createElement('span');
      ck.className = 'ck';
      ck.textContent = '{html}';
      d.appendChild(ck);
      d.appendChild(document.createTextNode(' as a string.'));
      wrap.appendChild(d);
      currentEmpty = d;
      return;
    }
    // Nested iframe with the user's HTML as srcdoc — inherits outer sandbox
    // (allow-scripts only, no allow-same-origin). User HTML cannot reach the
    // parent iframe DOM, localStorage, or cookies.
    clearWrap();
    var f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('srcdoc', html);
    f.style.cssText = 'width:100%;height:100%;border:0;background:transparent;flex:1';
    wrap.appendChild(f);
    currentFrame = f;
  }
  // Initial paint
  render(window.opencanvas && window.opencanvas.props ? window.opencanvas.props : {});
  // Live updates from the agent
  window.addEventListener('opencanvas:props', function(e){
    render(e && e.detail && e.detail.props ? e.detail.props : {});
  });
})();
</script>
</body></html>`;

/**
 * Calendar renderer template.
 *
 * Pure vanilla JS — no external libraries. Reads props from
 * window.opencanvas.props on first paint; subsequent updates arrive via
 * the 'opencanvas:props' DOM event. Supports two views:
 *   - 'year'  — 4×3 grid of mini-months with event dots + today ring
 *   - 'month' — single full-width month with day-of-week header + event chips
 *
 * Props shape: { view?, year?, month?, events?, title? }
 * Defaults to current month when props are absent or partial.
 */
const CALENDAR_SRCDOC = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;background:transparent;color:#fafafa;font-family:'Inter',system-ui,sans-serif}
#root{padding:14px;height:100%;display:flex;flex-direction:column;gap:10px;overflow:hidden}
.title{font-size:13px;font-weight:600;letter-spacing:-0.012em;color:#fafafa;text-align:center;margin-bottom:2px;flex-shrink:0}

/* ── year view ── */
.year-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;flex:1;min-height:0;overflow:auto}
.mini-month{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:6px;display:flex;flex-direction:column;gap:3px}
.mini-month-name{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#d4d4d8;text-align:center}
.mini-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;font-size:9px}
.mini-cell{aspect-ratio:1;display:flex;align-items:center;justify-content:center;color:#a1a1aa;border-radius:2px;position:relative;line-height:1}
.mini-cell.today{background:rgba(167,139,250,0.18);color:#fafafa;font-weight:700;outline:1.5px solid rgba(167,139,250,0.7);outline-offset:-1px}
.mini-cell.has-event::after{content:"";position:absolute;bottom:1px;left:50%;transform:translateX(-50%);width:3px;height:3px;border-radius:99px;background:#a78bfa}
.mini-cell.past{opacity:0.55}
.mini-cell.empty{visibility:hidden}

/* ── month view ── */
.month-view{display:flex;flex-direction:column;gap:6px;flex:1;min-height:0}
.month-header{font-size:14px;font-weight:600;text-align:center;color:#fafafa;flex-shrink:0}
.dow-row{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;font-size:10px;color:#71717a;text-transform:uppercase;letter-spacing:0.04em;text-align:center;flex-shrink:0}
.month-grid{display:grid;grid-template-columns:repeat(7,1fr);grid-auto-rows:1fr;gap:4px;flex:1;min-height:0}
.month-cell{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:5px;display:flex;flex-direction:column;gap:2px;min-height:0;overflow:hidden}
.month-cell.today{outline:1.5px solid rgba(167,139,250,0.7);outline-offset:-1px;background:rgba(167,139,250,0.08)}
.month-cell.past{opacity:0.55}
.month-cell.empty{visibility:hidden;border:none;background:none}
.month-cell-num{font-size:11px;font-weight:600;color:#fafafa;line-height:1.2}
.month-cell-events{display:flex;flex-direction:column;gap:1px;min-height:0;overflow:hidden}
.month-cell-event{font-size:9px;color:#ddd6fe;background:rgba(167,139,250,0.16);padding:1px 4px;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.4}

/* ── empty state ── */
.empty{color:#a1a1aa;font-size:12px;padding:24px;text-align:center;line-height:1.5}
.empty .ck{background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:4px;color:#ddd6fe;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px}
</style></head>
<body><div id="root"></div>
<script>
(function(){
  var MONTH_NAMES=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var DOW=['S','M','T','W','T','F','S'];

  function todayStr(){
    var d=new Date();
    var y=d.getFullYear();
    var m=String(d.getMonth()+1).padStart(2,'0');
    var dd=String(d.getDate()).padStart(2,'0');
    return y+'-'+m+'-'+dd;
  }

  function dateStr(year,month1,day){
    return year+'-'+String(month1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  }

  function daysInMonth(year,month1){
    return new Date(year,month1,0).getDate();
  }

  function startDow(year,month1){
    // 0=Sun..6=Sat
    return new Date(year,month1-1,1).getDay();
  }

  function buildEventSet(events){
    var s=Object.create(null);
    if(!Array.isArray(events))return s;
    for(var i=0;i<events.length;i++){
      var e=events[i];
      if(e&&e.date){
        if(!s[e.date])s[e.date]=[];
        s[e.date].push(e.label||'');
      }
    }
    return s;
  }

  function el(tag,cls){
    var n=document.createElement(tag);
    if(cls)n.className=cls;
    return n;
  }

  function renderMiniMonth(year,month1,evSet,today){
    var wrap=el('div','mini-month');
    var nameEl=el('div','mini-month-name');
    nameEl.textContent=MONTH_NAMES[month1-1];
    wrap.appendChild(nameEl);
    var grid=el('div','mini-grid');
    var dim=daysInMonth(year,month1);
    var sd=startDow(year,month1);
    // blank leading cells
    for(var i=0;i<sd;i++){
      grid.appendChild(el('div','mini-cell empty'));
    }
    for(var d=1;d<=dim;d++){
      var ds=dateStr(year,month1,d);
      var cell=el('div','mini-cell');
      if(ds<today)cell.className+=' past';
      if(ds===today)cell.className+=' today';
      if(evSet[ds])cell.className+=' has-event';
      cell.textContent=String(d);
      if(evSet[ds]&&evSet[ds].length){
        var labels=evSet[ds].filter(function(l){return l;});
        if(labels.length){cell.title=labels.join(', ');}
      }
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  function renderYear(root,year,evSet,today,title){
    if(title){var t=el('div','title');t.textContent=title;root.appendChild(t);}
    var grid=el('div','year-grid');
    for(var m=1;m<=12;m++){
      grid.appendChild(renderMiniMonth(year,m,evSet,today));
    }
    root.appendChild(grid);
  }

  function renderMonth(root,year,month1,evSet,today,title){
    if(title){var t=el('div','title');t.textContent=title;root.appendChild(t);}
    var mv=el('div','month-view');
    var hdr=el('div','month-header');
    hdr.textContent=MONTH_NAMES[month1-1]+' '+year;
    mv.appendChild(hdr);
    var dow=el('div','dow-row');
    for(var i=0;i<7;i++){var dc=el('div');dc.textContent=DOW[i];dow.appendChild(dc);}
    mv.appendChild(dow);
    var mgrid=el('div','month-grid');
    var dim=daysInMonth(year,month1);
    var sd=startDow(year,month1);
    // 6 rows * 7 cols = 42 cells total
    for(var ci=0;ci<42;ci++){
      var dayNum=ci-sd+1;
      if(dayNum<1||dayNum>dim){
        mgrid.appendChild(el('div','month-cell empty'));
      } else {
        var ds=dateStr(year,month1,dayNum);
        var cell=el('div','month-cell');
        if(ds<today)cell.className+=' past';
        if(ds===today)cell.className+=' today';
        var num=el('div','month-cell-num');
        num.textContent=String(dayNum);
        cell.appendChild(num);
        if(evSet[ds]&&evSet[ds].length){
          var evWrap=el('div','month-cell-events');
          var labels=evSet[ds];
          var shown=Math.min(labels.length,3);
          for(var li=0;li<shown;li++){
            var chip=el('div','month-cell-event');
            chip.textContent=labels[li]||'•';
            evWrap.appendChild(chip);
          }
          if(labels.length>shown){
            var more=el('div','month-cell-event');
            more.textContent='+'+(labels.length-shown)+' more';
            evWrap.appendChild(more);
          }
          cell.appendChild(evWrap);
        }
        mgrid.appendChild(cell);
      }
    }
    mv.appendChild(mgrid);
    root.appendChild(mv);
  }

  function render(props){
    var root=document.getElementById('root');
    while(root.firstChild)root.removeChild(root.firstChild);
    var p=props||{};
    var now=new Date();
    var view=p.view||'month';
    var year=p.year||now.getFullYear();
    var month1=p.month||now.getMonth()+1;
    var title=p.title||null;
    var evSet=buildEventSet(p.events);
    var today=todayStr();
    if(view==='year'){
      renderYear(root,year,evSet,today,title);
    } else {
      renderMonth(root,year,month1,evSet,today,title);
    }
  }

  var initProps=window.opencanvas&&window.opencanvas.props;
  render(initProps||null);
  window.addEventListener('opencanvas:props',function(e){
    render(e.detail&&e.detail.props||e.detail||null);
  });
})();
</script>
</body></html>`;

/**
 * Vega-Lite chart renderer template.
 *
 * Loads vega + vega-lite + vega-embed from a CDN (the only network
 * call inside the sandboxed iframe). Reads the spec from
 * window.opencanvas.props.spec on first render; subsequent prop
 * updates arrive via the 'opencanvas:props' DOM event the plugin
 * shim dispatches.
 *
 * Container fills 100% w/h; embed config sets `actions: false` (no
 * kebab menu) and a transparent background so the card surface
 * shows through. Dark theme baked into config so charts look right
 * against OpenCanvas card surfaces even when the agent's spec
 * doesn't supply its own theme.
 */
const CHART_SRCDOC = `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;background:transparent;color:#fafafa;font-family:'Inter',system-ui,sans-serif}
#chart{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.empty{color:#a1a1aa;font-size:12px;padding:24px;text-align:center;line-height:1.5}
.empty .ck{background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:4px;color:#ddd6fe;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px}
.error{color:#fca5a5;font-size:11px;padding:18px;font-family:'JetBrains Mono',ui-monospace,monospace;white-space:pre-wrap;overflow:auto}
</style>
<script src="https://cdn.jsdelivr.net/npm/vega@5.30.0/build/vega.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/vega-lite@5.21.0/build/vega-lite.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/vega-embed@6.26.0/build/vega-embed.min.js"></script>
</head><body>
<div id="chart"></div>
<script>
(function(){
var DARK_CONFIG={
  background:"transparent",
  view:{stroke:"transparent"},
  axis:{labelColor:"#a1a1aa",titleColor:"#d4d4d8",gridColor:"rgba(255,255,255,0.06)",domainColor:"rgba(255,255,255,0.18)",tickColor:"rgba(255,255,255,0.18)"},
  legend:{labelColor:"#d4d4d8",titleColor:"#fafafa"},
  title:{color:"#fafafa",subtitleColor:"#a1a1aa"},
  range:{category:["#a78bfa","#60a5fa","#34d399","#fbbf24","#fb7185","#67e8f9","#f472b6","#84cc16"]}
};
var container=document.getElementById("chart");
function clear(node){while(node.firstChild)node.removeChild(node.firstChild);}
function showEmpty(){
  clear(container);
  var d=document.createElement("div");d.className="empty";
  var t1=document.createTextNode("No spec yet — pass ");
  var code=document.createElement("span");code.className="ck";code.textContent="{spec}";
  var t2=document.createTextNode(" in the widget payload.");
  var br=document.createElement("br");
  var t3=document.createTextNode("Vega-Lite v5 JSON.");
  d.appendChild(t1);d.appendChild(code);d.appendChild(t2);d.appendChild(br);d.appendChild(t3);
  container.appendChild(d);
}
function showError(msg){clear(container);var p=document.createElement("pre");p.className="error";p.textContent=String(msg);container.appendChild(p);}
function render(spec){
  if(!spec){showEmpty();return;}
  var s=Object.assign({width:"container",height:"container",config:DARK_CONFIG},spec);
  if(!s.config){s.config=DARK_CONFIG;}
  try{
    vegaEmbed(container,s,{actions:false,renderer:"canvas"}).catch(function(e){showError(e.message||e);});
  }catch(e){showError(e.message||e);}
}
function readSpec(){var p=window.opencanvas&&window.opencanvas.props;return p&&p.spec;}
render(readSpec());
document.addEventListener("opencanvas:props",function(e){render(e.detail&&e.detail.spec);});
window.addEventListener("resize",function(){render(readSpec());});
})();
</script></body></html>`;
