import { useEffect } from 'react';
import { useStore, type Agent } from '@/store/store';
import { buildSpawnCommand, inferAgentProvider, type HarnessConfig } from '@/store/config';
import { planetSeedSpecs } from '@shared/planets';
import type { OfficeCharacterName } from '@/scene/office/cast';
import type { AccentColorName } from '@/design/tokens';

/** The AIRA default roster — section 31 of the transformation brief.
 *
 *  The Office opens with AIRA (the existing orchestrator, spawned by `useHive`)
 *  and the nine planets. This hook provisions the PLANETS; it deliberately does
 *  not touch AIRA, whose spawn already has a home in `useHive`.
 *
 *  WHY RESTORABLE, AND NOT A NEW LIFECYCLE. A "restorable" entry is Munder
 *  Difflin's own representation of an agent that is part of your team but has no
 *  live terminal right now: a full spawn recipe (id, cwd, command, provider,
 *  model) that `useRestoreTeam` brings back at boot and that the floor strip
 *  offers a one-click respawn for. Reusing it means the planets arrive through
 *  the existing spawn path — real PTYs, real hive provisioning (memory, mailbox,
 *  registry identity), real Office presence — instead of a new fake-UI state.
 *  Nothing here invents a second agent system.
 *
 *  PROVISION ONCE, AND ONLY ONTO AN EMPTY FLOOR. The seed fires only when the
 *  floor has no worker planets anywhere (active, archived, or restorable). So it
 *  happens exactly once on a fresh office, never fights a restore of your own
 *  team, and never resurrects a planet you deliberately closed — a closed planet
 *  is `archived`, which is one of the three lists we check.
 *
 *  IDENTITY COMES FROM `shared/planets.ts`, never from a name typed here. The
 *  planet's durable id is `agentId` (`mercury`, …), its floor label is
 *  `displayName`, its card role is `title`, and its pixel appearance is
 *  `avatarId` — the SAME Office character art as before, no repainting. Renaming
 *  a planet later (Edit Agent) changes the label only; the id, the avatar and
 *  the hive record are untouched.
 *
 *  ONE ENGINE FOR THE WHOLE OFFICE. Every planet spawns on AIRA's engine
 *  (`godProvider` / `godModel`, the "AIRA's engine" step of onboarding and the
 *  engine picker in the Command Center). There is no per-planet provider
 *  configuration: one active provider/model is shared by AIRA and all nine
 *  planets, and changing it changes what the office runs on.
 */

/** How long after boot to provision.
 *
 *  Mirrors `useRestoreTeam`'s reasoning: App.tsx reconciles the persisted roster
 *  against the PTYs actually alive in the main process, and `useHive` spawns
 *  AIRA on its own timer. Firing before those land would read a floor that is
 *  empty only because nothing has populated it yet. The delay is also the window
 *  in which a dismiss ✕ clears any planet you don't want back. */
export const AIRA_ROSTER_SEED_DELAY_MS = 1800;

/** Latched the moment the seed starts, module-level: two mounts (floor strip +
 *  fullscreen rail) must not each provision their own roster. */
let seeded = false;

/** Accents are cosmetic — a stable rotation so the nine planets don't all wear
 *  the same card colour. Not identity: nothing reads the accent back. */
const PLANET_ACCENTS: AccentColorName[] = ['coral', 'mint', 'sky', 'lemon', 'lilac', 'peach'];

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || 'hive';
}

/** Is any of these a planet the user already has (or deliberately closed)? */
function hasWorkerPlanets(list: Agent[]): boolean {
  return list.some((a) => !a.isGod && !a.isAssistant);
}

export function useAiraRoster(config: HarnessConfig | null): void {
  useEffect(() => {
    if (seeded || !config?.onboardingComplete) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = (): void => {
      if (seeded || timer) return;
      const s = useStore.getState();
      // AIRA and the prep assistant do not count as planets: AIRA always spawns,
      // so gating on a literally empty `agents` here would mean never seeding.
      if (
        hasWorkerPlanets(s.agents) ||
        hasWorkerPlanets(s.archivedAgents) ||
        hasWorkerPlanets(s.restorableAgents)
      ) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        if (seeded) return;
        const now = useStore.getState();
        if (
          hasWorkerPlanets(now.agents) ||
          hasWorkerPlanets(now.archivedAgents) ||
          hasWorkerPlanets(now.restorableAgents)
        ) {
          return;
        }
        // Latch BEFORE the writes so a second mount's timer, which may fire in
        // this same tick, sees it.
        seeded = true;
        void provision();
      }, AIRA_ROSTER_SEED_DELAY_MS);
    };

    // Driven by a store subscription, not a mount timer: the roster arrives
    // asynchronously (App.tsx's PTY reconcile + AIRA's own spawn), so a
    // one-shot check at mount could look at a floor that is empty merely
    // because nothing has rendered yet and then never look again.
    check();
    const unsub = useStore.subscribe(check);
    return () => { unsub(); if (timer) clearTimeout(timer); };
    // `config` fields below are read at fire time through the closure; only the
    // readiness gate belongs in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.onboardingComplete, config?.harnessHome, config?.godProvider, config?.godModel, config?.defaultCommand]);

  async function provision(): Promise<void> {
    if (!config) return;
    // The office's single active engine: AIRA's. `inferAgentProvider` only runs
    // when nothing has ever been chosen, and reproduces what the spawn path
    // itself would infer from `defaultCommand`.
    const provider = config.godProvider ?? inferAgentProvider(config.defaultCommand);
    const model = config.godModel;
    const command = buildSpawnCommand(config, model, provider);
    // Planets work in the user's project when there is one (the same folder a
    // hire defaults to), falling back to the hive home AIRA itself runs in.
    const cwd = config.registeredRepos?.[0] ?? config.harnessHome;
    if (!command || !cwd) return;

    // Identity (id, label, title, avatar) comes from shared/planets.ts; the
    // engine and working directory are the office's, applied here.
    const entries: Agent[] = planetSeedSpecs().map((p, i) => ({
      id: p.id,
      name: p.name,
      // Appearance is the existing Office character; only the label is AIRA's.
      character: p.character as OfficeCharacterName,
      accent: PLANET_ACCENTS[i % PLANET_ACCENTS.length],
      description: p.role,
      project: basename(cwd),
      tmuxTarget: '',
      cwd,
      goal: p.mission,
      status: 'idle',
      // Not "starting up": nothing is running yet. The planet is on the floor,
      // idle, and `useRestoreTeam` brings the terminal up through the normal
      // respawn path — which is also what surfaces a spawn failure.
      action: 'idle',
      progress: 0,
      ptyId: `pty-${p.id}`,
      command,
      provider,
      model,
      recentTextTs: Date.now()
    }));
    useStore.getState().seedRestorableAgents(entries);
  }
}
