'use strict';

/**
 * AIRA — the planet roster and the orchestrator's identity.
 *
 * Munder Difflin's orchestrator mechanism is unchanged; what these tests hold is
 * the transformation itself: the orchestrator is AIRA, the floor's specialists
 * are the nine planets, every planet is a full agent (specialization is a
 * ROUTING PREFERENCE, not a capability limit), and each planet's displayed
 * identity is decoupled from the Office avatar it wears — so a rename cannot
 * change the art, and the art cannot change a rename.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const planets = loadTs('src/shared/planets.ts');
const { DEFAULT_GOD_NAME, resolveGodName } = loadTs('src/shared/godIdentity.ts');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const EXPECTED = [
  ['mercury', 'Mercury', 'research'],
  ['venus', 'Venus', 'experience'],
  ['mars', 'Mars', 'architecture'],
  ['earth', 'Earth', 'engineering'],
  ['jupiter', 'Jupiter', 'business'],
  ['saturn', 'Saturn', 'documentation'],
  ['uranus', 'Uranus', 'evolution'],
  ['neptune', 'Neptune', 'quality'],
  ['pluto', 'Pluto', 'operations']
];

test('the orchestrator is AIRA', () => {
  assert.equal(DEFAULT_GOD_NAME, 'AIRA');
  assert.equal(resolveGodName(undefined), 'AIRA');
  assert.equal(planets.AIRA.displayName, 'AIRA');
  assert.equal(planets.AIRA.title, 'Central Intelligence');
});

test('the durable hive id stays "god", so existing hives keep their data', () => {
  // Renaming the storage id would orphan every existing hive's orchestrator,
  // its tasks and its memory. Identity changed; the registry key did not.
  assert.equal(planets.AIRA.agentId, 'god');
});

test('the roster is the nine planets, in dispatch order, with stable ids', () => {
  assert.equal(planets.PLANETS.length, EXPECTED.length);
  EXPECTED.forEach(([id, displayName, specialization], i) => {
    const p = planets.PLANETS[i];
    assert.equal(p.agentId, id, `planet ${i} id`);
    assert.equal(p.displayName, displayName, `planet ${i} display name`);
    assert.equal(p.specialization, specialization, `planet ${i} specialization`);
    assert.equal(p.routingPriority, i + 1, `planet ${i} is out of routing order`);
    assert.equal(p.enabled, true, `${id} must ship enabled`);
  });
});

test('every planet is a full agent: real config, not a role stub', () => {
  for (const p of planets.PLANETS) {
    assert.ok(p.title && p.title.length > 3, `${p.agentId} has no title`);
    assert.ok(p.mission && p.mission.length > 20, `${p.agentId} has no mission`);
    assert.ok(p.personality && p.personality.length > 40, `${p.agentId} has no personality`);
  }
});

test('personalities are distinct, so the floor does not sound like one bot', () => {
  const seen = new Set(planets.PLANETS.map((p) => p.personality));
  assert.equal(seen.size, planets.PLANETS.length);
});

test('a planet id resolves to exactly one planet — display name and id both work', () => {
  assert.equal(planets.planetById('mars').displayName, 'Mars');
  assert.equal(planets.planetForName('Mars').agentId, 'mars');
  assert.equal(planets.planetForName('  mercury ').agentId, 'mercury');
  assert.equal(planets.planetForName('nobody'), null);
  assert.equal(planets.planetById('nobody'), null);
});

test('identity is decoupled from the avatar: nine planets, nine distinct avatars', () => {
  const avatars = planets.PLANETS.map((p) => p.avatarId);
  assert.equal(new Set(avatars).size, avatars.length, 'two planets share an avatar');
  // The display name lives in `displayName`, never in `avatarId` — that is what
  // makes a rename (Edit Agent) leave the Office art alone.
  for (const p of planets.PLANETS) {
    assert.notEqual(p.avatarId, p.displayName.toLowerCase(), `${p.agentId} avatar id IS its name`);
  }
  assert.equal(planets.planetByAvatar('dwight').agentId, 'mars');
  assert.equal(planets.planetByAvatar('michael'), null, 'the orchestrator avatar is not a planet');
});

test('the Office avatars every planet wears actually exist in the cast', () => {
  const cast = read('src/renderer/src/scene/office/cast.ts');
  const typeBlock = cast.slice(cast.indexOf('export type OfficeCharacterName'), cast.indexOf('export interface CastMember'));
  for (const p of planets.PLANETS) {
    assert.ok(typeBlock.includes(`'${p.avatarId}'`), `${p.avatarId} is not an Office avatar`);
  }
  assert.ok(typeBlock.includes(`'${planets.AIRA.avatarId}'`), 'AIRA has no Office avatar');
});

test('the cast layers AIRA/planet identity onto the avatars instead of replacing them', () => {
  const cast = read('src/renderer/src/scene/office/cast.ts');
  assert.match(cast, /from '@shared\/planets'/, 'the cast is no longer driven by the roster');
  assert.match(cast, /planetByAvatar/, 'the cast no longer resolves planets');
  // Every legacy avatar is kept, including the ones no planet wears.
  for (const legacy of ['kelly', 'ryan', 'toby', 'creed', 'meredith']) {
    assert.ok(cast.includes(`'${legacy}'`), `legacy avatar ${legacy} was deleted`);
  }
});

test('specialization routes the obvious cases (strong, not hard, specialization)', () => {
  assert.equal(planets.routeTask('research the competitors and find APIs').agentId, 'mercury');
  assert.equal(planets.routeTask('design the system architecture and database schema').agentId, 'mars');
  assert.equal(planets.routeTask('implement the checkout endpoint').agentId, 'earth');
  assert.equal(planets.routeTask('write the README and API reference').agentId, 'saturn');
  assert.equal(planets.routeTask('run load testing and look for hallucinations').agentId, 'neptune');
  assert.equal(planets.routeTask('set up CI/CD and deploy with docker').agentId, 'pluto');
  assert.equal(planets.routeTask('build the pricing model and GTM plan').agentId, 'jupiter');
  assert.equal(planets.routeTask('audit the design system for accessibility').agentId, 'venus');
  assert.equal(planets.routeTask('improve the prompt with meta-learning').agentId, 'uranus');
});

test('an unrecognised task gets no preference — AIRA decides, the router does not guess', () => {
  assert.equal(planets.routeTask('do the thing'), null);
  assert.equal(planets.routeTask(''), null);
  assert.equal(planets.routeTask(undefined), null);
});

test('AIRA can override the preference: every planet is routable for any task', () => {
  // The router names a PREFERENCE; it never removes a planet from the floor, and
  // a disabled planet is the only thing that leaves the routing list.
  for (const p of planets.PLANETS) {
    assert.ok(planets.enabledPlanets().some((e) => e.agentId === p.agentId));
  }
  assert.equal(planets.planetsForSpecialization('research').length, 1);
  assert.equal(planets.preferredPlanet('research').agentId, 'mercury');
});

test('the orchestrator prompt carries the roster and the override rule', () => {
  const block = planets.planetsPromptBlock();
  for (const p of planets.PLANETS) {
    assert.ok(block.includes(p.displayName.toUpperCase()), `${p.displayName} missing from the roster block`);
    assert.ok(block.includes(p.specialization), `${p.displayName}'s specialization missing`);
  }
  assert.match(block, /FULL autonomous agent/);
  assert.match(block, /ROUTING PREFERENCE, never a capability limit/);
  assert.match(block, /MAY override/);
  // Prompt-cache safety: the block is static config, so it must not carry a
  // timestamp, a live count or any other per-spawn volatility.
  assert.doesNotMatch(block, /\d{4}-\d{2}-\d{2}/, 'the roster block carries a date');
  assert.doesNotMatch(block, /\b\d{4,}\b/, 'the roster block carries live state');
});

test('the default roster seeds all nine planets, with identity and nothing else', () => {
  const specs = planets.planetSeedSpecs();
  assert.equal(specs.length, EXPECTED.length);
  EXPECTED.forEach(([id, name], i) => {
    assert.equal(specs[i].id, id, `seed ${i} id`);
    assert.equal(specs[i].name, name, `seed ${i} name`);
    assert.equal(specs[i].role, planets.PLANETS[i].title, `seed ${i} role`);
    assert.equal(specs[i].mission, planets.PLANETS[i].mission, `seed ${i} mission`);
    assert.equal(specs[i].character, planets.PLANETS[i].avatarId, `seed ${i} avatar`);
  });
  // AIRA is the orchestrator, spawned by useHive — never part of the seed, or
  // the office would end up with two orchestrator cards.
  assert.ok(!specs.some((s) => s.id === 'god'), 'AIRA must not be seeded as a planet');
  // The engine is the office's to choose, so no recipe may hardcode one.
  for (const s of specs) {
    for (const engineField of ['command', 'provider', 'model', 'cwd']) {
      assert.ok(!(engineField in s), `seed spec carries ${engineField} — engine/cwd belong to the office`);
    }
  }
});

test('a fresh office is provisioned once, and never over a planet the user closed', () => {
  const hook = read('src/renderer/src/hooks/useAiraRoster.ts');
  // The seed goes through the EXISTING spawn representation, not a new system.
  assert.match(hook, /seedRestorableAgents/, 'the seed bypasses the existing roster store');
  // Empty-floor gate: active, archived AND restorable, all three.
  assert.match(hook, /hasWorkerPlanets\(s\.agents\)/);
  assert.match(hook, /hasWorkerPlanets\(s\.archivedAgents\)/);
  assert.match(hook, /hasWorkerPlanets\(s\.restorableAgents\)/);
  // AIRA itself always spawns, so it must not be what makes the floor look busy.
  assert.match(hook, /!a\.isGod && !a\.isAssistant/);
  // One active engine for the whole office: planets run AIRA's.
  assert.match(hook, /config\.godProvider/, 'planets do not inherit the office engine');
  assert.match(hook, /buildSpawnCommand/, 'planets are not spawned with the app spawn builder');
  // Mounted, or provisioning never runs.
  assert.match(read('src/renderer/src/App.tsx'), /useAiraRoster\(hiveOpened \? config : null\)/);
  // The store action exists and is idempotent by id.
  const store = read('src/renderer/src/store/store.ts');
  assert.match(store, /seedRestorableAgents: \(entries\) =>/);
  assert.match(store, /!s\.agents\.some\(\(a\) => a\.id === e\.id\)/);
  assert.match(store, /!s\.archivedAgents\.some\(\(a\) => a\.id === e\.id\)/);
});

test('one engine for the whole office: switching AIRA\'s engine switches the planets', () => {
  const panel = read('src/renderer/src/components/CommandCenterPanel.tsx');
  // The switch persists the office engine as AIRA's (what every planet inherits)
  // AND drags the running floor onto it — asleep planets via their saved recipe,
  // live planets via the existing, already-tested restart path.
  assert.match(panel, /updateConfig\(\{ godProvider: engineProvider, godModel: engineModel \}\)/);
  assert.match(panel, /retargetRestorableEngine\(\{/);
  assert.match(panel, /await restartWithModel\(planet, engineModel/);
  // Per-planet provider configuration must not exist anywhere.
  assert.ok(!/planetOverrides|planetModel|perPlanetProvider/.test(panel));
  // The store action retargets ONLY the engine fields — identity survives.
  const store = read('src/renderer/src/store/store.ts');
  const action = store.slice(store.indexOf('retargetRestorableEngine: (engine) =>'));
  const body = action.slice(0, action.indexOf('seedRestorableAgents: (entries) =>'));
  assert.match(body, /command: engine\.command, provider: engine\.provider, model: engine\.model/);
  for (const identityField of ['id:', 'name:', 'character:', 'cwd:', 'worktreePath:']) {
    assert.ok(!body.includes(identityField), `retargeting the engine rewrote ${identityField}`);
  }
  assert.match(body, /a\.isGod \|\| a\.isAssistant/, 'AIRA/assistant recipes must not be retargeted here');
});

test('the hive injects AIRA and the roster, and no longer calls god by name', () => {
  const hive = read('src/main/hive.ts');
  assert.match(hive, /planetsPromptBlock\(\)/, 'the roster never reaches the orchestrator prompt');
  assert.doesNotMatch(hive, /GOD \/ ORCHESTRATOR/, 'the old orchestrator identity is still injected');
  assert.match(hive, /RUNNING BUILD: AIRA v/, 'agents do not know which app they run in');
});
