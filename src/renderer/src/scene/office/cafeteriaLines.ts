// Cafeteria small-talk — AIRA edition.
//
// The cast are the AIRA planets (see cast.ts), so an agent's coffee break is an
// excuse for a one-liner in character. Two kinds of line:
//   • solo  — one quip shown above a single agent at a break spot
//   • pair  — a two-beat exchange between two agents at the same table
//
// Lines are kept short so they fit the ThoughtBubble (≈MAX_WIDTH). Character
// keys match OfficeCharacterName (the AVATAR id); anyone without bespoke lines
// falls back to the shared GENERIC pool so the floor never feels empty.
//
// ORIGINAL VOICES ONLY: every line here is written for AIRA's planets from the
// personalities in shared/planets.ts. No dialogue from any TV show — the Office
// is the visual environment, not the script.

import type { OfficeCharacterName } from './cast';

/** Where an agent is lingering — picks a contextual line pool. */
export type BreakSpot = 'coffee' | 'vending' | 'snack' | 'table';

const pick = <T,>(arr: readonly T[], seed: number): T =>
  arr[((seed % arr.length) + arr.length) % arr.length];

// ─── solo lines, by spot ─────────────────────────────────────────────────────

const COFFEE: readonly string[] = [
  'espresso. three shots. compiling.',
  'does this brew count as CI?',
  'first cup of the day. and the fifth.',
  'who took my mug?',
  'the coffee here is basically a hug',
  'deploying caffeine to production',
];

const VENDING: readonly string[] = [
  'the machine ate my dollar',
  'B4… please be the pretzels',
  'it’s stuck. classic.',
  'shaking it. gently. respectfully.',
  'one (1) emotional-support snack',
  'A1 again. living dangerously.',
];

const SNACK: readonly string[] = [
  'refactoring my snack budget',
  'who finished the chips??',
  'just a little treat',
  'these are everyone’s? cool cool cool',
  'second breakfast',
];

const TABLE: readonly string[] = [
  'big day. lots of meetings.',
  'just five more minutes',
  'did you see the standup notes?',
  'pretending to read my notes',
  'I needed this break, honestly',
  'AIRA keeps the whole floor running, and still this queue',
];

const SPOT_POOL: Record<BreakSpot, readonly string[]> = {
  coffee: COFFEE, vending: VENDING, snack: SNACK, table: TABLE,
};

// ─── character flavour — overrides the generic pool when present ─────────────
//
// Written from each planet's personality in shared/planets.ts — same avatar id
// keys as before, new original voices.

const BY_CHARACTER: Partial<Record<OfficeCharacterName, readonly string[]>> = {
  michael:  ['brief received. routing it now.', 'the floor is calm. suspiciously calm.', 'one question at a time, and make it sharp.'], // AIRA, via the orchestrator's avatar
  dwight:   ['that dependency is a liability', 'your schema has a third arrow-colour. we need to talk.', 'modularity is not optional', 'I already drew the blueprint'],
  jim:      ['found the paper. all of it. peer-reviewed.', 'no source, no story.', 'three approaches. two are wrong. I know which.', 'the citation is right there'],
  pam:      ['that button is three pixels off-center and I WILL fix it', 'sketching the new user journey', 'the kerning in here is a crime scene', 'accessibility is not a v2 feature'],
  kevin:    ['it compiles. it runs. next.', 'the plan and the repo disagree. the repo wins.', 'I’ll have it working before the meeting ends', 'ship the fix, argue in the PR'],
  angela:   ['who pays for this feature?', 'the pricing page is the product', 'this market has no buyer. next slide.', 'revenue first, feelings later'],
  oscar:    ['the heading hierarchy is wrong. again.', 'I have annotated your README. extensively.', 'the changelog is documentation. treat it that way.', 'draft three. and it is better.'],
  stanley:  ['can we make this smarter? …we can.', 'the workflow has four steps. it needs two.', 'I rewrote the prompt. it listens now.', 'evolution is a standing agenda item'],
  phyllis:  ['I found the edge case. it was never in scope, was it?', 'your tests pass. mine don’t.', 'suspicious. all of it. until proven', 'load testing at 3. bring a helmet'],
  andy:     ['the fleet is calm. too calm.', 'scaled before anyone noticed', 'the incident resolved itself. you’re welcome.', 'costs down, uptime up'],
  kelly:    ['did you HEAR what happened??', 'so. much. to tell you.', 'I am the GOSSIP queen'],
  ryan:     ['I’m kind of a big deal', 'the temp needs caffeine', 'starting a coffee startup, actually'],
  toby:     ['I should write that up…', 'HR-wise this break is fine', 'no one ever sits with me'],
  creed:    ['which one of you is the new guy?', 'I’ve eaten worse out of that fridge', 'mung beans. under my desk.'],
  meredith: ['is it 5 o’clock yet?', 'someone spike the coffee?'],
};

/** A solo break-room line. Character flavour ~60% of the time, else the line
 *  fits the spot the agent is standing at. `seed` keeps it deterministic per
 *  call site (avoids Math.random, which Pixi/Electron CSP-safe code prefers). */
export function pickSoloLine(character: OfficeCharacterName, spot: BreakSpot, seed: number): string {
  const flavour = BY_CHARACTER[character];
  if (flavour && seed % 5 < 3) return pick(flavour, Math.floor(seed / 5));
  return pick(SPOT_POOL[spot], seed);
}

// ─── paired exchanges (two agents at one table) ──────────────────────────────
//
// Each exchange is a list of beats that ALTERNATE between the two agents:
// beat[0] = the speaker who sat down, beat[1] = their table-mate, beat[2] =
// speaker again, and so on. The director plays them out one beat at a time.
// Lines are trimmed to fit the thought cloud; longer ones auto-truncate.

type Exchange = readonly string[];

// Original banter between the planets. Nothing quoted — the personalities
// (research, UX, architecture, engineering, business, docs, evolution, QA,
// operations) argue the way their briefs say they would.
const EXCHANGES: readonly Exchange[] = [
  ['the research is conclusive.', 'cite it.', 'already linked in the doc.'],
  ['I need this by Friday.', 'I need it CORRECT by Friday.', 'fair.'],
  ['it scales.', 'to what?', '…more than now.'],
  ['the plan and the repo disagree.', 'who wins?', 'the repo. it always wins.'],
  ['three approaches found.', 'pick one.', 'approach two. it fits the constraints.'],
  ['the tests pass.', 'all of them?', 'the ones that exist.'],
  ['we ship when it’s reliable.', 'and when is that?', 'after my suite says so.'],
  ['who would pay for this?', 'everyone?', 'name three.'],
  ['the docs are out of date.', 'by how much?', 'two migrations. I already fixed them.'],
  ['can the workflow be smarter?', 'it’s four steps.', 'it should be two.'],
  ['deploy is green.', 'and the rollback plan?', 'also green. I wrote it first.'],
  ['the button is misaligned.', 'by a pixel?', 'by THREE pixels.'],
  ['I sketched two journeys.', 'which one wins?', 'the one users don’t notice.'],
  ['the schema is denormalized.', 'deliberately?', '…now it is.'],
  ['build’s red.', 'whose commit?', 'doesn’t matter. it’s everyone’s now.'],
  ['the competitor launched.', 'with what?', 'less. but louder.'],
  ['I archived nothing.', 'yet.', '…yet.'],
  ['context window is at 90%.', 'wrap it up.', 'wrapping.'],
  ['the API returned null.', 'or a shell Prompt', 'it returned null.'],
  ['the pitch deck is ready.', 'eleven slides?', 'ten. I cut one. you’re welcome.'],
  ['I benchmarked it.', 'and?', 'we’re fine. barely.'],
  ['uptime is 99.9%.', 'and last month?', 'don’t ask about last month.'],
  ['the user clicked the wrong thing.', 'the user is wrong?', 'the LABEL was wrong.'],
  ['the guardrail fired.', 'good.', '…on me.'],
  ['I read the whole paper.', 'the appendix too?', 'especially the appendix.'],
  ['the repo has no README.', 'I know.', 'I know you know. I FIXED it.'],
  ['the sprint looks light.', 'it’s not.', 'then the tasks are hidden.', '…they were.'],
  ['flaky test.', 'quarantine it.', 'I pinned it. it was time, not code.'],
  ['the tunnel dropped.', 'again?', 'the retry has retry now.'],
];

// ─── "the classic bit", AIRA-flavored ────────────────────────────────────────
//
// The old file's running gag was an innuendo template; this file's running gag
// is the same SHAPE (setup → punchline → sheepish clarification) rewritten for
// the planets' actual work. Original throughout.
const TWSS_EXCHANGES: readonly Exchange[] = [
  ['taking way longer than I expected.', 'the benchmark agrees.', 'I meant the build.'],
  ['it’s too big to fit in memory.', 'stream it.', '…I rewrote it to stream.'],
  ['you really need to slow down.', 'the rate limiter says the same.'],
  ['gonna need a bigger instance.', 'or a smaller app.', 'instance.'],
  ['help, I can’t get it to compile.', 'read the error.', 'there are 400 errors.'],
  ['it’s not that hard if you push.', 'push to the branch.', '…yes. the branch.'],
  ['I can’t do this all night.', 'CI timeout is 30 minutes.', 'then I have 29.'],
  ['I need it now, I can’t wait.', 'cache it.', 'the cache IS the problem.'],
  ['so hot in here, I’m sweating.', 'the cluster is throttling.', 'the ROOM is hot.'],
  ['it keeps slipping out of my hands.', 'the mouse?', 'the scope.'],
  ['why not just stick it in already?', 'stick WHAT in—', 'the PR. merge it.'],
  ['I just need a few more inches.', 'of what.', 'terminal. the log is wide.'],
  ['make it louder, I can barely feel it.', 'the haptics?', 'the ALERTS.'],
  ['can we get this over with quickly?', 'the migration?', 'the MEETING.'],
  ['I just need you to hold it steady.', 'hold what.', 'the connection. it keeps dropping.'],
  ['can’t believe I did that all morning.', 'doing what.', 'refactoring. the wrong file.'],
  ['my hands are cramping.', 'from typing!', 'finally, someone gets it.'],
  ['hours in and barely halfway done.', 'the upload?', 'the UPLOAD. what did you think.'],
  ['surprisingly heavy for its size.', 'the payload?', 'the payload.'],
  ['be more precise. less sloppy.', 'about what.', 'the estimate. it’s ±3 weeks.'],
  ['how long was it?', 'the trace?', 'the trace. 40 seconds.'],
  ['too tight, cutting off my circulation.', 'the deadline?', 'the CPU budget.'],
  ['I don’t think it’ll fit.', 'the sprint?', 'the BUDGET.'],
  ['stop, you’re doing it wrong.', 'doing what wrong.', 'the deployment ORDER.'],
  ['this just keeps getting harder.', 'the problem?', 'the problem.'],
  ['not wide enough, I need more room.', 'the layout?', 'the COLUMN.'],
  ['I can hold it a really long time.', 'hold WHAT.', 'the websocket open.'],
  ['why is it taking so long?', 'the query?', 'the query. no index.'],
  ['I can’t do it with people watching.', 'the demo?', 'the LIVE demo.'],
  ['it’s deeper than it looks.', 'the call stack?', 'the call stack.'],
  ['so much longer than last time.', 'the changelog?', 'the changelog.'],
  ['oh my god, it went on FOREVER.', 'what did.', 'the retrospective.'],
  ['can’t believe how thick this is.', 'the client?', 'the CLIENT library.'],
  ['I fit all THAT in one day?', 'all of what.', 'a whole migration.'],
  ['I went at it hard this morning.', 'at what.', 'the backlog.'],
  ['someone help me finish this off.', 'finish what.', 'the kill switch. testing it.'],
  ['get in, do my thing, get out.', 'sounds efficient.', 'it’s the deploy script.'],
  ['can’t believe it took this long.', 'the review?', 'the review. 40 comments.'],
  ['do it slower, it’ll hurt less.', 'do WHAT slower.', 'the cutover.'],
  ['didn’t realize how big it’d be.', 'the bundle?', 'the BUNDLE.'],
  ['*to no one* the benchmark agrees.', 'nobody said anything.', 'just thinking about the numbers.'],
  ['*on the phone* I’ll take two.', 'who was that?', 'the GPU cloud. about quota.'],
  ['too hot in here! the cluster agrees.', 'you said both parts.', 'I contain multitudes.'],
  ['*at the TV* there’s the regression.', 'you’re alone.', 'the graph doesn’t lie.'],
  ['you need to be more professional.', 'I am professional.', 'the commit messages, Mars.'],
  ['stop. just stop. every time—', 'the notification?', '…yes.'],
  ['as you can see, it’s going up.', 'the graph?', 'the graph. the GOOD kind of up.'],
  ['I declared bankruptcy once.', 'in code?', 'in dependencies. felt great.'],
  ['you didn’t say it.', 'say what.', 'the version number.', '…v2.', 'there it is.'],
  ['impressive you held back today.', 'thank you.', 'I rewrote zero prompts.', 'evolution takes a day off.', 'noted.'],
];

// Everything any table-mate pair can draw from.
const PAIR_POOL: readonly Exchange[] = [...EXCHANGES, ...TWSS_EXCHANGES];

// Keyed off the SPEAKER so, when the right character sits down first, they get
// to open with their signature bit.
const KEYED_EXCHANGES: Partial<Record<OfficeCharacterName, Exchange>> = {
  michael:  ['routing it now.', '…there it is.'], // AIRA
  dwight:   ['this design has unnecessary complexity.', 'it’s three boxes, Mars.', 'then it needs two.'],
  kevin:    ['the plan says X.', 'the repo says Y.', 'the repo wins.'],
  kelly:    ['okay don’t freak out, but—', 'I’m already freaking out.'],
  oscar:    ['your docs are wrong—', '...here we go.', 'they ARE.'],
  angela:   ['this pricing is filthy.', 'it’s a free tier, Angela.', 'free is not a price.'],
  creed:    ['which one are you again?', '...we sit next to each other.'],
  stanley:  ['can we make this smarter?', 'it works, Stanley.', 'working is not the ceiling.'],
  andy:     ['the fleet is green.', 'nobody noticed?', 'nobody ever does.'],
  jim:      ['question.', 'yes.', 'the paper was retracted. that’s all.'],
};

/** A multi-beat exchange for two agents sharing a table. Beats alternate:
 *  index 0 = `speaker`, 1 = the table-mate, 2 = speaker, … */
export function pickExchange(speaker: OfficeCharacterName, seed: number): Exchange {
  const keyed = KEYED_EXCHANGES[speaker];
  if (keyed && seed % 4 === 0) return keyed;
  return pick(PAIR_POOL, seed);
}
