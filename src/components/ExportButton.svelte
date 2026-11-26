<script>
  // "Download my data (.zip)": on the paywall, so a locked account can leave with everything, and under Account in
  // Settings. src/lib/data-export.js fetches every row and file and packs the zip on the device; the label counts the
  // files as they arrive, in a cell as wide as its longest text, so the button never changes size.
  import Download from '@lucide/svelte/icons/download';
  import { CAN_EXPORT, downloadExport } from '../lib/data-export.js';
  import TEXT from './paywall.json';

  /** @type {{ class?: string, iconClass?: string, noteClass?: string }} */
  let { class: className = '', iconClass = 'size-4', noteClass = 'text-xs' } = $props();

  let busy = $state(false);
  let done = $state(0);
  let total = $state(0);
  /** What happened last: the outcome of the download, or why it failed. */
  let note = $state('');
  let failed = $state(false);
  const label = $derived(!busy ? TEXT.export : total ? TEXT.exportFiles.replace('{done}', String(done)).replace('{total}', String(total)) : TEXT.exportStarting);

  async function run() {
    busy = true;
    failed = false;
    note = '';
    done = 0;
    total = 0;
    try {
      const result = await downloadExport((fetched, all) => {
        done = fetched;
        total = all;
      });
      note = (result.skipped.length ? TEXT.exportSkipped : TEXT.exportDone).replace('{notes}', String(result.notes)).replace('{files}', String(result.files)).replace('{skipped}', String(result.skipped.length));
    } catch (error) {
      failed = true;
      note = /** @type {Error} */ (error).message || TEXT.exportFailed;
    }
    busy = false;
  }
</script>

{#if CAN_EXPORT}
  <button class={className} disabled={busy} onclick={run}>
    <Download class="{iconClass} {busy ? 'animate-pulse' : ''}" />
    <span class="grid tabular-nums">
      <!-- The longest label holds the width -->
      <span class="invisible col-start-1 row-start-1" aria-hidden="true">{TEXT.export}</span>
      <span class="col-start-1 row-start-1">{label}</span>
    </span>
  </button>
  {#if note}<p class="{noteClass} {failed ? 'text-accent' : 'text-ink-faint'}" role="status">{note}</p>{/if}
{/if}
