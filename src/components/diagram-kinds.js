// The icon for each kind of diagram box (NODE_KINDS in src/lib/models.js), shared by the canvas palette, the boxes
// and the inspector.
import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';
import Server from '@lucide/svelte/icons/server';
import Cpu from '@lucide/svelte/icons/cpu';
import Database from '@lucide/svelte/icons/database';
import HardDrive from '@lucide/svelte/icons/hard-drive';
import Layers from '@lucide/svelte/icons/layers';
import Globe from '@lucide/svelte/icons/globe';
import Bot from '@lucide/svelte/icons/bot';
import SquareDashed from '@lucide/svelte/icons/square-dashed';
import Type from '@lucide/svelte/icons/type';

export const KIND_ICON = { client: MonitorSmartphone, service: Server, worker: Cpu, database: Database, storage: HardDrive, queue: Layers, external: Globe, agent: Bot, zone: SquareDashed, text: Type };
