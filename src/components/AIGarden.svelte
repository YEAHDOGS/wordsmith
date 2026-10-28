<script>
  import Plus from '@lucide/svelte/icons/plus';
  import Pause from '@lucide/svelte/icons/pause';
  import Play from '@lucide/svelte/icons/play';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import { router } from '../lib/router.svelte.js';

  let { gardenMode = $bindable(false) } = $props();

  const INITIAL_AGENTS = [
    { id: 'claude', name: 'Claude', kind: 'fox', role: 'Careful builder', task: 'Tending the feature board', color: 'tangerine', x: 18, y: 38, active: true },
    { id: 'codex', name: 'Codex', kind: 'rabbit', role: 'Fast fixer', task: 'Gathering loose ideas', color: 'sky', x: 48, y: 62, active: true },
    { id: 'gpt', name: 'GPT', kind: 'bear', role: 'Thought partner', task: 'Taking a little break', color: 'rose', x: 77, y: 34, active: false },
  ];
  const CRITTERS = ['fox', 'rabbit', 'bear', 'cat', 'frog'];
  let agents = $state(INITIAL_AGENTS.map((agent) => ({ ...agent })));
  let selected = $state('claude');
  let notice = $state('');
  const current = $derived(agents.find((agent) => agent.id === selected) || agents[0]);

  function addAgent() {
    const index = agents.length + 1;
    const critter = CRITTERS[(index - 1) % CRITTERS.length];
    const agent = { id: `helper-${index}`, name: `Garden helper ${index - 1}`, kind: critter, role: 'Ready for a new connection', task: 'Waiting by the pond', color: 'mint', x: 15 + ((index * 23) % 70), y: 30 + ((index * 17) % 42), active: false };
    agents.push(agent);
    selected = agent.id;
    notice = `${agent.name} joined the garden. Connect a provider to give them work.`;
  }

  function toggleAutonomy() {
    if (!current) return;
    current.active = !current.active;
    current.task = current.active ? 'Ready to tend the board' : 'Taking a little break';
    notice = `${current.name} is ${current.active ? 'ready for work' : 'paused'}.`;
  }

  function openView(view) {
    gardenMode = false;
    router.go(view);
  }
</script>

<section class="garden flex min-h-0 flex-1 flex-col overflow-auto" aria-label="AI Garden">
  <header class="flex shrink-0 items-center justify-between gap-4 border-b border-line px-4 py-3 sm:px-7">
    <div class="min-w-0">
      <p class="font-mono text-xs uppercase tracking-[0.18em] text-complete">A little world for your agents</p>
      <h1 class="mt-1 text-fluid-xl font-black tracking-tight">AI Garden <span aria-hidden="true">✿</span></h1>
    </div>
    <button class="spring press flex shrink-0 items-center gap-2 border border-line-strong bg-surface px-3 py-2 text-sm font-semibold hover:border-complete hover:text-complete" onclick={addAgent}>
      <Plus class="size-4" /> <span class="hidden sm:inline">Invite a friend</span><span class="sm:hidden">Invite</span>
    </button>
  </header>

  <div class="garden-layout grid min-h-0 flex-1 gap-4 p-3 sm:gap-6 sm:p-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
    <div class="flex min-h-[25rem] flex-col">
      <div class="mb-3 flex items-center justify-between gap-3 text-sm">
        <p class="text-ink-muted">Preview friends for now. Connect a provider to give them real work.</p>
        <span class="shrink-0 font-mono text-xs text-ink-faint">{agents.length} preview friends</span>
      </div>
      <div class="meadow relative min-h-[24rem] flex-1 overflow-hidden border border-line sm:min-h-[30rem]" aria-label="Garden meadow">
        <div class="sun"></div>
        <div class="hill hill-back"></div><div class="hill hill-front"></div>
        <div class="pond"><span>✧</span></div>
        <div class="garden-path"></div>
        <div class="flower flower-a">✿</div><div class="flower flower-b">✿</div><div class="flower flower-c">✿</div>
        <div class="tree tree-a"><i></i><b></b></div><div class="tree tree-b"><i></i><b></b></div>
        {#each agents as agent (agent.id)}
          <button class="critter-wrap {selected === agent.id ? 'chosen' : ''}" style="--x:{agent.x}%;--y:{agent.y}%;--wander:{((agents.indexOf(agent) % 3) + 1) * 2}s" onclick={() => (selected = agent.id)} aria-label="Select {agent.name}, {agent.active ? 'ready' : 'paused'}" aria-pressed={selected === agent.id}>
            <span class="critter {agent.kind} {agent.color}"><i class="ear ear-left"></i><i class="ear ear-right"></i><i class="eye eye-left"></i><i class="eye eye-right"></i><i class="snout"></i><i class="cheek cheek-left"></i><i class="cheek cheek-right"></i><i class="belly"></i><i class="tail"></i></span>
            <span class="critter-name">{agent.name}</span>
            {#if agent.active}<span class="ready-dot" title="Ready"></span>{/if}
          </button>
        {/each}
        <div class="meadow-caption"><Sparkles class="size-4" /> A shared space for the work in progress</div>
      </div>
    </div>

    <aside class="flex min-h-0 flex-col gap-5 border-t border-line pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
      <div>
        <h2 class="mb-2 font-mono text-xs uppercase tracking-widest text-ink-faint">Preview friends</h2>
        <div class="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
          {#each agents as agent (agent.id)}
            <button class="spring flex min-w-36 shrink-0 items-center gap-3 border px-3 py-2 text-left lg:w-full {selected === agent.id ? 'border-complete bg-complete-soft' : 'border-line bg-surface hover:border-line-strong'}" onclick={() => (selected = agent.id)}>
              <span class="mini-critter {agent.kind} {agent.color}"><i></i><b></b></span>
              <span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold">{agent.name}</span><span class="block text-xs text-ink-faint">{agent.active ? 'Wandering' : 'Resting'}</span></span>
              <span class="size-2 rounded-full {agent.active ? 'bg-complete' : 'bg-line-strong'}"></span>
            </button>
          {/each}
        </div>
      </div>

      {#if current}
        <div class="border-t border-line pt-4">
          <p class="font-mono text-xs uppercase tracking-widest text-ink-faint">Today in the garden</p>
          <h2 class="mt-2 text-lg font-bold">{current.name}</h2>
          <p class="text-sm text-ink-muted">{current.role}</p>
          <p class="mt-4 border-l-2 border-complete pl-3 text-sm text-ink-muted">{current.task}</p>
          <button class="spring press mt-5 flex w-full items-center justify-center gap-2 bg-ink px-3 py-2.5 text-sm font-semibold text-app hover:bg-complete" onclick={toggleAutonomy}>
            {#if current.active}<Pause class="size-4" /> Pause friend{:else}<Play class="size-4" /> Let them wander{/if}
          </button>
          <p class="mt-2 text-xs leading-relaxed text-ink-faint">Local preview only. No provider is connected yet; connect an agent to let it work on notes and the scrumboard.</p>
        </div>
      {/if}

      <div class="mt-auto border-t border-line pt-4">
        <h2 class="font-mono text-xs uppercase tracking-widest text-ink-faint">Keep your work close</h2>
        <div class="mt-3 flex gap-2">
          <button class="spring flex-1 border border-line px-3 py-2 text-center text-sm hover:border-accent" onclick={() => openView('notes')}>Notes</button>
          <button class="spring flex-1 border border-line px-3 py-2 text-center text-sm hover:border-accent" onclick={() => openView('features')}>Scrumboard</button>
        </div>
      </div>
    </aside>
  </div>
  {#if notice}<div class="fixed bottom-5 left-1/2 z-20 -translate-x-1/2 border border-complete bg-surface px-4 py-3 text-sm shadow-lg" role="status">{notice}</div>{/if}
</section>

<style>
  .garden { background: var(--ws-app); }
  .meadow { isolation: isolate; background: linear-gradient(180deg, var(--ws-garden-sky) 0%, var(--ws-garden-sky) 35%, var(--ws-garden-meadow) 35%, var(--ws-garden-meadow) 100%); }
  .sun { position:absolute; width:clamp(3rem,8vw,6rem); aspect-ratio:1; border-radius:50%; background:var(--ws-garden-sun); top:8%; right:15%; box-shadow:0 0 3rem var(--ws-garden-sun-glow); }
  .hill { position:absolute; border-radius:50% 50% 0 0; }
  .hill-back { width:70%; height:37%; left:-10%; bottom:21%; background:var(--ws-garden-hill); transform:rotate(-5deg); }
  .hill-front { width:88%; height:34%; right:-13%; bottom:18%; background:var(--ws-garden-grass); transform:rotate(4deg); }
  .pond { position:absolute; z-index:1; width:24%; height:12%; right:13%; bottom:23%; border:3px solid var(--ws-garden-water-edge); border-radius:50%; background:var(--ws-garden-water); color:var(--ws-garden-water-light); text-align:center; padding-top:1.4%; }
  .pond span { display:inline-block; animation:glimmer 2.4s ease-in-out infinite; }
  .garden-path { position:absolute; z-index:2; width:38%; height:17%; left:24%; bottom:0; background:var(--ws-garden-path); clip-path:polygon(38% 0,62% 0,100% 100%,0 100%); }
  .tree { position:absolute; z-index:2; bottom:40%; width:3rem; height:5rem; }
  .tree-a { left:8%; }.tree-b { right:7%; transform:scale(.78); bottom:43%; }
  .tree i { position:absolute; bottom:0; left:42%; width:16%; height:52%; background:var(--ws-garden-wood); }
  .tree b { position:absolute; top:0; left:4%; width:92%; aspect-ratio:1; border-radius:48%; background:var(--ws-garden-leaves); box-shadow:inset -8px -4px 0 var(--ws-garden-leaves-shade); }
  .flower { position:absolute; z-index:3; color:var(--ws-garden-flower); font-size:1.5rem; animation:nod 2.8s ease-in-out infinite alternate; }
  .flower-a { left:23%; bottom:29%; }.flower-b { left:64%; bottom:34%; color:var(--ws-garden-flower-alt); }.flower-c { right:27%; bottom:25%; font-size:1rem; }
  .critter-wrap { position:absolute; z-index:4; left:var(--x); top:var(--y); display:flex; flex-direction:column; align-items:center; transform:translate(-50%,-50%); animation:amble var(--wander) ease-in-out infinite alternate; }
  .critter-wrap:hover,.critter-wrap.chosen { z-index:6; }
  .critter { position:relative; display:block; width:4.5rem; height:4rem; border:2px solid var(--ws-garden-outline); border-radius:46% 46% 40% 40%; background:var(--critter-color); box-shadow:inset -5px -5px 0 var(--critter-shade), 0 5px 0 var(--ws-garden-shadow); transition:transform .15s var(--ease-spring); }
  .critter-wrap:hover .critter,.critter-wrap.chosen .critter { transform:translateY(-4px) scale(1.06); }
  .critter.tangerine,.mini-critter.tangerine { --critter-color:var(--ws-garden-orange);--critter-shade:var(--ws-garden-orange-shade); }
  .critter.sky,.mini-critter.sky { --critter-color:var(--ws-garden-blue);--critter-shade:var(--ws-garden-blue-shade); }
  .critter.rose,.mini-critter.rose { --critter-color:var(--ws-garden-pink);--critter-shade:var(--ws-garden-pink-shade); }
  .critter.mint,.mini-critter.mint { --critter-color:var(--ws-garden-mint);--critter-shade:var(--ws-garden-mint-shade); }
  .ear { position:absolute; z-index:-1; top:-.75rem; width:1.1rem; height:1.5rem; border:2px solid var(--ws-garden-outline); border-radius:50% 50% 30% 30%; background:var(--critter-color); }
  .ear-left { left:.55rem; transform:rotate(-16deg); }.ear-right { right:.55rem; transform:rotate(16deg); }
  .fox .ear { border-radius:30% 70% 25% 25%; height:1.35rem; top:-.7rem; }.fox .ear-left { transform:rotate(-28deg); }.fox .ear-right { transform:rotate(28deg); }
  .bear .ear { width:1.2rem; height:1.2rem; top:-.4rem; border-radius:50%; }.bear .ear-left { left:.1rem; }.bear .ear-right { right:.1rem; }
  .cat .ear { border-radius:20% 80% 15% 15%; }.frog .ear { display:none; }
  .eye { position:absolute; top:1.25rem; width:.22rem; height:.3rem; border-radius:50%; background:var(--ws-garden-face); }.eye-left { left:1.25rem; }.eye-right { right:1.25rem; }
  .snout { position:absolute; top:1.55rem; left:50%; width:.55rem; height:.4rem; transform:translateX(-50%); border-radius:50%; background:var(--ws-garden-muzzle); }
  .cheek { position:absolute; top:1.65rem; width:.5rem; height:.3rem; border-radius:50%; background:var(--ws-garden-blush); }.cheek-left { left:.55rem; }.cheek-right { right:.55rem; }
  .belly { position:absolute; bottom:0; left:25%; width:50%; height:34%; border-radius:50% 50% 0 0; background:var(--ws-garden-belly); opacity:.9; }
  .tail { position:absolute; right:-.65rem; bottom:.15rem; width:.95rem; height:.75rem; border:2px solid var(--ws-garden-outline); border-radius:50%; background:var(--critter-color); }
  .rabbit .tail,.frog .tail { display:none; }
  .critter-name { margin-top:.4rem; border:1px solid var(--ws-garden-label-line); background:var(--ws-garden-label); padding:.2rem .45rem; color:var(--ws-garden-label-ink); font-size:.68rem; font-weight:700; white-space:nowrap; }
  .ready-dot { position:absolute; top:-.45rem; right:-.5rem; width:.7rem; height:.7rem; border:2px solid var(--ws-garden-outline); border-radius:50%; background:var(--ws-garden-ready); }
  .mini-critter { position:relative; width:1.5rem; height:1.4rem; flex:none; border:1px solid var(--ws-garden-outline); border-radius:45%; background:var(--critter-color); }
  .mini-critter i,.mini-critter b { position:absolute; top:-.3rem; width:.45rem; height:.5rem; border:1px solid var(--ws-garden-outline); border-radius:50%; background:var(--critter-color); }.mini-critter i { left:.1rem; }.mini-critter b { right:.1rem; }
  .mini-critter.fox i,.mini-critter.fox b { border-radius:20% 80% 10% 10%; }
  .meadow-caption { position:absolute; z-index:5; left:.75rem; bottom:.75rem; display:flex; align-items:center; gap:.4rem; color:var(--ws-garden-caption); font-size:.72rem; }
  @keyframes amble { from { translate:-3px 0; } to { translate:4px -2px; } }
  @keyframes nod { from { rotate:-8deg; } to { rotate:8deg; } }
  @keyframes glimmer { 50% { opacity:.4; transform:translateX(8px); } }
  @media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation-duration:.01ms !important; animation-iteration-count:1 !important; scroll-behavior:auto !important; } }
  @media (max-width:639px) { .critter { width:3.8rem; height:3.5rem; }.garden-layout { grid-template-rows:minmax(25rem,1fr) auto; }.meadow-caption { max-width:80%; font-size:.65rem; } }
</style>
