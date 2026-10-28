<script>
  import Building2 from '@lucide/svelte/icons/building-2';
  import Bot from '@lucide/svelte/icons/bot';
  import Pause from '@lucide/svelte/icons/pause';
  import Play from '@lucide/svelte/icons/play';
  import { router } from '../lib/router.svelte.js';

  let { gardenMode = $bindable(false) } = $props();

  const INITIAL_AGENTS = [
    { id: 'claude', name: 'Claude', x: 24, y: 63, active: true },
    { id: 'codex', name: 'Codex', x: 49, y: 46, active: true },
    { id: 'gpt', name: 'GPT', x: 75, y: 67, active: false },
  ];
  const INITIAL_BUILDINGS = [
    { id: 'tower-one', name: 'Northstar', x: 20, y: 31, height: 27, style: 'one' },
    { id: 'tower-two', name: 'Meridian', x: 40, y: 24, height: 35, style: 'two' },
    { id: 'tower-three', name: 'Vertex', x: 60, y: 34, height: 24, style: 'three' },
    { id: 'tower-four', name: 'Lumen', x: 81, y: 28, height: 31, style: 'four' },
    { id: 'tower-five', name: 'Arcology', x: 31, y: 58, height: 18, style: 'five' },
    { id: 'tower-six', name: 'Exchange', x: 68, y: 57, height: 20, style: 'six' },
  ];
  const BUILDING_STYLES = ['one', 'two', 'three', 'four', 'five', 'six'];
  const NOTICE_DURATION = 1800;
  let agents = $state(INITIAL_AGENTS.map((agent) => ({ ...agent })));
  let buildings = $state(INITIAL_BUILDINGS.map((building) => ({ ...building })));
  let selected = $state('claude');
  let selectedBuilding = $state('');
  let notice = $state('');
  const current = $derived(agents.find((agent) => agent.id === selected) || agents[0]);

  function addAgent() {
    const index = agents.length + 1;
    const agent = { id: `resident-${index}`, name: `Agent ${index}`, x: 14 + ((index * 29) % 72), y: 41 + ((index * 19) % 36), active: false };
    agents.push(agent);
    selected = agent.id;
  }

  function addBuilding() {
    const index = buildings.length + 1;
    const building = {
      id: `building-${index}`,
      name: `Tower ${index}`,
      x: 12 + ((index * 17) % 74),
      y: 23 + ((index * 13) % 40),
      height: 18 + ((index * 7) % 17),
      style: BUILDING_STYLES[(index - 1) % BUILDING_STYLES.length],
    };
    buildings.push(building);
    selectedBuilding = building.id;
    notice = `${building.name} added`;
    setTimeout(() => (notice = ''), NOTICE_DURATION);
  }

  function toggleAutonomy() {
    if (!current) return;
    current.active = !current.active;
  }

  function openView(view) {
    gardenMode = false;
    router.go(view);
  }
</script>

<section class="city-mode flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="AI Garden city">
  <div class="city-toolbar flex shrink-0 items-center justify-between gap-3 border-b border-line px-3 py-2 sm:px-5">
    <span class="district-light" aria-hidden="true"></span>
    <div class="flex items-center gap-2">
      <button class="city-action spring press" onclick={addBuilding} title="Add building" aria-label="Add building"><Building2 class="size-4" /><span>Add building</span></button>
      <button class="city-action city-action-icon spring press" onclick={addAgent} title="Add agent" aria-label="Add agent"><Bot class="size-4" /></button>
    </div>
  </div>

  <div class="city-viewport relative min-h-0 flex-1 overflow-hidden" aria-label="Futuristic city district">
    <div class="city-haze"></div>
    <div class="distant-skyline" aria-hidden="true">
      <i style="--left:2%;--width:5%;--height:24%"></i><i style="--left:8%;--width:4%;--height:34%"></i>
      <i style="--left:14%;--width:6%;--height:28%"></i><i style="--left:22%;--width:4%;--height:41%"></i>
      <i style="--left:28%;--width:7%;--height:32%"></i><i style="--left:37%;--width:5%;--height:44%"></i>
      <i style="--left:44%;--width:4%;--height:30%"></i><i style="--left:51%;--width:7%;--height:38%"></i>
      <i style="--left:61%;--width:4%;--height:29%"></i><i style="--left:68%;--width:6%;--height:42%"></i>
      <i style="--left:77%;--width:5%;--height:33%"></i><i style="--left:84%;--width:7%;--height:40%"></i>
      <i style="--left:94%;--width:5%;--height:26%"></i>
    </div>
    <div class="city-floor" aria-hidden="true">
      <div class="street street-one"></div><div class="street street-two"></div><div class="street street-three"></div>
      <div class="street-markings"></div>
    </div>
    <div class="city-rails" aria-hidden="true"><span></span><span></span><span></span></div>

    {#each buildings as building (building.id)}
      <button class="building {building.style} {selectedBuilding === building.id ? 'building-selected' : ''}"
        style="--x:{building.x}%;--y:{building.y}%;--height:{building.height}%"
        onclick={() => (selectedBuilding = building.id)} title={building.name} aria-label="Select {building.name}" aria-pressed={selectedBuilding === building.id}>
        <span class="building-roof"></span><span class="building-face"></span><span class="building-side"></span><span class="building-base"></span>
      </button>
    {/each}

    {#each agents as agent (agent.id)}
      <button class="resident {selected === agent.id ? 'resident-selected' : ''} {agent.active ? 'resident-active' : ''}"
        style="--x:{agent.x}%;--y:{agent.y}%" onclick={() => (selected = agent.id)} title={agent.name} aria-label="Select {agent.name}, {agent.active ? 'active' : 'paused'}" aria-pressed={selected === agent.id}>
        <span class="resident-shadow"></span><span class="resident-body"><i class="resident-head"></i><i class="resident-visor"></i><i class="resident-pack"></i></span>
        <span class="resident-label">{agent.name}</span>
      </button>
    {/each}

    {#if current}
      <div class="agent-console" aria-label="Selected agent controls">
        <span class="console-indicator {current.active ? 'online' : ''}"></span>
        <span class="console-name">{current.name}</span>
        <span class="console-state">{current.active ? 'Active' : 'Paused'}</span>
        <button class="console-toggle spring press" onclick={toggleAutonomy} title={current.active ? 'Pause agent' : 'Resume agent'} aria-label={current.active ? 'Pause agent' : 'Resume agent'}>
          {#if current.active}<Pause class="size-4" />{:else}<Play class="size-4" />{/if}
        </button>
      </div>
    {/if}
    {#if notice}<div class="city-notice" role="status">{notice}</div>{/if}
  </div>

  <footer class="city-footer flex shrink-0 items-center justify-between gap-3 border-t border-line px-3 py-2 sm:px-5">
    <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
      {#each agents as agent (agent.id)}
        <button class="agent-tab spring {selected === agent.id ? 'agent-tab-selected' : ''}" onclick={() => (selected = agent.id)} title={agent.name} aria-label="Select {agent.name}" aria-pressed={selected === agent.id}>
          <span class="agent-pip {agent.active ? 'online' : ''}"></span>{agent.name}
        </button>
      {/each}
    </div>
    <div class="flex shrink-0 gap-2">
      <button class="city-footer-link spring" onclick={() => openView('notes')}>Notes</button>
      <button class="city-footer-link spring" onclick={() => openView('features')}>Board</button>
    </div>
  </footer>
</section>

<style>
  .city-mode { background: var(--ws-app); }
  .city-toolbar,.city-footer { background: var(--ws-surface); }
  .city-action { display:flex; align-items:center; gap:.45rem; min-height:2.1rem; border:1px solid var(--ws-line-strong); padding:.4rem .65rem; color:var(--ws-ink-muted); font-size:.75rem; }
  .city-action:hover { border-color:var(--ws-city-cyan); color:var(--ws-city-cyan); }
  .city-action-icon { width:2.1rem; justify-content:center; padding:0; }
  .district-light { width:.42rem; height:.42rem; border-radius:50%; background:var(--ws-city-cyan); box-shadow:0 0 10px var(--ws-city-glow); }
  .city-viewport { isolation:isolate; min-height:20rem; background:linear-gradient(180deg,var(--ws-city-sky) 0%,var(--ws-city-horizon) 57%,var(--ws-city-ground) 100%); }
  .city-haze { position:absolute; inset:28% 0 0; background:radial-gradient(ellipse at 50% 24%,var(--ws-city-haze),transparent 58%); }
  .distant-skyline { position:absolute; inset:8% 0 37%; opacity:.58; }
  .distant-skyline i { position:absolute; bottom:0; left:var(--left); width:var(--width); height:var(--height); border-top:1px solid var(--ws-city-distant-line); background:linear-gradient(90deg,var(--ws-city-distant-a),var(--ws-city-distant-b)); clip-path:polygon(0 4%,100% 0,100% 100%,0 100%); }
  .distant-skyline i:nth-child(3n)::after { content:""; position:absolute; inset:12% 12% 0; background:repeating-linear-gradient(90deg,transparent 0 8px,var(--ws-city-window-dim) 8px 10px),repeating-linear-gradient(0deg,transparent 0 10px,var(--ws-city-window-dim) 10px 12px); }
  .city-floor { position:absolute; inset:45% -10% -38%; overflow:hidden; transform:perspective(850px) rotateX(56deg) scale(1.3); transform-origin:center top; background-color:var(--ws-city-floor); background-image:linear-gradient(45deg,var(--ws-city-grid) 1px,transparent 1px),linear-gradient(-45deg,var(--ws-city-grid) 1px,transparent 1px); background-size:4.5rem 4.5rem; }
  .street { position:absolute; background:var(--ws-city-road); box-shadow:0 0 0 1px var(--ws-city-road-edge), inset 0 0 0 1px var(--ws-city-road-inner); }
  .street-one { width:120%; height:2.7rem; left:-10%; top:42%; transform:rotate(-17deg); }
  .street-two { width:120%; height:2rem; left:-10%; top:74%; transform:rotate(-17deg); }
  .street-three { width:2rem; height:140%; left:50%; top:-20%; transform:rotate(27deg); }
  .street-markings { position:absolute; left:-10%; top:44%; width:120%; height:1px; transform:rotate(-17deg); background:repeating-linear-gradient(90deg,var(--ws-city-marking) 0 1rem,transparent 1rem 1.8rem); }
  .city-rails { position:absolute; inset:0; pointer-events:none; }
  .city-rails span { position:absolute; height:1px; left:0; right:0; background:linear-gradient(90deg,transparent,var(--ws-city-rail),transparent); }
  .city-rails span:nth-child(1) { top:27%; }.city-rails span:nth-child(2) { top:49%; opacity:.45; }.city-rails span:nth-child(3) { bottom:15%; opacity:.25; }
  .building { position:absolute; z-index:2; left:var(--x); top:var(--y); width:clamp(2.25rem,7vw,5rem); height:var(--height); min-height:5.5rem; transform:translate(-50%,-100%); }
  .building-face,.building-side,.building-roof,.building-base { position:absolute; display:block; }
  .building-face { inset:0 16% 0 0; border:1px solid var(--ws-city-outline); border-bottom:0; background:linear-gradient(90deg,var(--building-face-a),var(--building-face-b)); }
  .building-face::after { content:""; position:absolute; inset:7% 10%; background:repeating-linear-gradient(90deg,transparent 0 8px,var(--building-window) 8px 10px),repeating-linear-gradient(0deg,transparent 0 10px,var(--building-window) 10px 12px); opacity:.84; }
  .building-side { top:0; right:0; width:16%; height:100%; transform:skewY(-30deg); transform-origin:left top; border:1px solid var(--ws-city-outline); background:var(--building-side); }
  .building-roof { top:-.45rem; left:0; right:16%; height:.45rem; transform:skewX(-45deg); transform-origin:bottom left; background:var(--building-roof); border:1px solid var(--ws-city-outline); }
  .building-base { bottom:-.35rem; left:-.25rem; right:-.4rem; height:.55rem; transform:skewX(-45deg); background:var(--ws-city-base); border:1px solid var(--ws-city-outline); }
  .building::after { content:""; position:absolute; left:42%; top:-.4rem; width:1px; height:.4rem; background:var(--ws-city-cyan); box-shadow:0 0 8px var(--ws-city-glow); }
  .building.one { --building-face-a:var(--ws-city-glass-a);--building-face-b:var(--ws-city-glass-b);--building-side:var(--ws-city-glass-side);--building-roof:var(--ws-city-roof-a);--building-window:var(--ws-city-window); }
  .building.two { --building-face-a:var(--ws-city-silver-a);--building-face-b:var(--ws-city-silver-b);--building-side:var(--ws-city-silver-side);--building-roof:var(--ws-city-roof-b);--building-window:var(--ws-city-window-warm); }
  .building.three { --building-face-a:var(--ws-city-teal-a);--building-face-b:var(--ws-city-teal-b);--building-side:var(--ws-city-teal-side);--building-roof:var(--ws-city-roof-c);--building-window:var(--ws-city-window); }
  .building.four { --building-face-a:var(--ws-city-purple-a);--building-face-b:var(--ws-city-purple-b);--building-side:var(--ws-city-purple-side);--building-roof:var(--ws-city-roof-d);--building-window:var(--ws-city-window-warm); }
  .building.five { --building-face-a:var(--ws-city-blue-a);--building-face-b:var(--ws-city-blue-b);--building-side:var(--ws-city-blue-side);--building-roof:var(--ws-city-roof-e);--building-window:var(--ws-city-window); }
  .building.six { --building-face-a:var(--ws-city-bronze-a);--building-face-b:var(--ws-city-bronze-b);--building-side:var(--ws-city-bronze-side);--building-roof:var(--ws-city-roof-f);--building-window:var(--ws-city-window-warm); }
  .building-selected .building-base { outline:1px solid var(--ws-city-cyan); }
  .building-selected::after { height:.7rem; top:-.7rem; }
  .resident { position:absolute; z-index:4; left:var(--x); top:var(--y); width:2.6rem; height:4rem; transform:translate(-50%,-50%); }
  .resident-shadow { position:absolute; left:.35rem; right:.35rem; bottom:.12rem; height:.38rem; border-radius:50%; background:var(--ws-city-agent-shadow); filter:blur(2px); }
  .resident-body { position:absolute; left:.65rem; bottom:.45rem; width:1.25rem; height:2rem; border:1px solid var(--ws-city-agent-outline); border-radius:.45rem .45rem .25rem .25rem; background:linear-gradient(90deg,var(--ws-city-agent-a),var(--ws-city-agent-b)); box-shadow:inset -.25rem 0 0 var(--ws-city-agent-shade); }
  .resident-head { position:absolute; left:.2rem; top:-.76rem; width:.8rem; height:.8rem; border:1px solid var(--ws-city-agent-outline); border-radius:45% 45% 38% 38%; background:var(--ws-city-helmet); }
  .resident-visor { position:absolute; left:.25rem; top:-.53rem; width:.7rem; height:.24rem; border-radius:50%; background:var(--ws-city-visor); box-shadow:0 0 5px var(--ws-city-glow); }
  .resident-pack { position:absolute; left:-.24rem; top:.27rem; width:.32rem; height:.85rem; border-radius:.1rem; background:var(--ws-city-pack); }
  .resident-active .resident-body { background:linear-gradient(90deg,var(--ws-city-agent-active-a),var(--ws-city-agent-active-b)); }
  .resident-selected { z-index:6; }
  .resident-selected::before { content:""; position:absolute; left:.15rem; right:.15rem; bottom:0; height:.5rem; border:1px solid var(--ws-city-cyan); border-radius:50%; box-shadow:0 0 10px var(--ws-city-glow); }
  .resident-label { position:absolute; top:100%; left:50%; transform:translateX(-50%); margin-top:.25rem; color:var(--ws-city-label); font:600 .65rem/1.2 var(--font-sans); text-shadow:0 1px 4px var(--ws-city-shadow); white-space:nowrap; }
  .agent-console { position:absolute; z-index:8; right:.75rem; bottom:.75rem; display:flex; align-items:center; gap:.55rem; border:1px solid var(--ws-city-console-line); background:var(--ws-city-console); padding:.45rem .5rem .45rem .7rem; color:var(--ws-city-label); box-shadow:0 7px 18px var(--ws-city-shadow); }
  .console-indicator,.agent-pip { flex:none; width:.42rem; height:.42rem; border-radius:50%; background:var(--ws-city-muted); }
  .console-indicator.online,.agent-pip.online { background:var(--ws-city-cyan); box-shadow:0 0 8px var(--ws-city-glow); }
  .console-name { font-size:.74rem; font-weight:650; }.console-state { border-left:1px solid var(--ws-city-console-line); padding-left:.5rem; color:var(--ws-city-muted); font-size:.68rem; }
  .console-toggle { display:grid; width:1.8rem; height:1.8rem; place-items:center; color:var(--ws-city-label); }
  .city-notice { position:absolute; z-index:10; top:.75rem; left:50%; transform:translateX(-50%); border:1px solid var(--ws-city-console-line); background:var(--ws-city-console); padding:.4rem .7rem; color:var(--ws-city-label); font-size:.75rem; }
  .agent-tab { display:flex; align-items:center; gap:.45rem; min-height:2rem; border:1px solid transparent; padding:.35rem .55rem; color:var(--ws-ink-faint); font-size:.72rem; white-space:nowrap; }
  .agent-tab:hover,.agent-tab-selected { border-color:var(--ws-line-strong); color:var(--ws-ink); }
  .city-footer-link { padding:.35rem .45rem; color:var(--ws-ink-muted); font-size:.72rem; }.city-footer-link:hover { color:var(--ws-city-cyan); }
  @media (max-width:640px) { .city-viewport { min-height:17rem; }.city-floor { inset:53% -25% -44%; transform:perspective(700px) rotateX(59deg) scale(1.45); }.building { width:clamp(2rem,9vw,3.5rem); }.resident { transform:translate(-50%,-50%) scale(.82); }.resident-label { font-size:.58rem; }.city-toolbar { padding-inline:.65rem; }.agent-console { right:.4rem; bottom:.4rem; }.city-footer { padding-inline:.5rem; } }
  @media (max-height:500px) { .city-viewport { min-height:9rem; }.building { min-height:4rem; }.resident { transform:translate(-50%,-50%) scale(.68); } }
  @media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } }
</style>
