import { h } from '../dom.js';
import { coursePracticeTabs } from './interview-bank.js';
import { fetchButton } from '../views/research-desk.js';

const PARTS = { ai_ml: 'ai', system_design: 'systems', full_stack: 'build', dsa: 'dsa' };
const TRACKS = [
  ['ai_ml', 'AI & machine learning', 'Explain how you choose data, evaluate a model and handle a wrong prediction.', 'A baseline, an evaluation table and an explanation of the mistakes.'],
  ['system_design', 'System design', 'Turn a requirement into a request flow, then explain scale, failure and trade-offs.', 'A system diagram, estimates and a record of your design decisions.'],
  ['full_stack', 'Full-stack development', 'Build a feature from the interface to the API and database, then test it.', 'Working code, tests and a short demo with a clear README.'],
  ['dsa', 'DSA & coding interviews', 'Explain your approach, write a solution and test its edge cases under time pressure.', 'Solutions with a dry run, test cases and time and space costs.'],
];
const routeFor = (day, part) => {
  const route = day.route || '#/learning/read/' + encodeURIComponent(`interview/day-${day.day}`) + '?from=weekly';
  return part ? route + (route.includes('?') ? '&' : '?') + 'part=' + part : route;
};

export function courseRoadmap(data, { refresh, canGenerate = false, canResearch = false, state = {} } = {}) {
  const weeks = data.weeks || [], course = data.course || {};
  const total = data.total || course.total_days || 90, completed = data.completed || 0;
  const next = weeks.flatMap(week => week.days || []).find(day => day.day === data.next_day);
  const currentWeek = weeks.find(week => week.days?.some(day => day.day === next?.day)) || weeks.at(-1);
  const phases = course.phases?.length ? course.phases : [{ title: 'Your course', start_day: 1, end_day: total }];
  const activePhase = Math.max(0, phases.findIndex(phase => (next?.day || total) >= phase.start_day && (next?.day || total) <= phase.end_day));
  if (!state.openWeeks) state.openWeeks = new Set(currentWeek ? [currentWeek.number] : []);
  if (state.phase === undefined) state.phase = activePhase;
  state.phase = Math.min(state.phase, phases.length - 1);
  const root = h('div', { class: 'course-hub' });
  const today = next?.learning_path || next?.topics || [];
  const dayRoute = next ? routeFor(next) : weeks[0]?.days[0]?.route || '#/learning/plan';
  const session = course.daily_session || [];
  const action = next?.available
    ? h('a', { class: 'btn btn-primary course-start', href: dayRoute, text: `${completed ? 'Continue' : 'Start'} Day ${next.day} →` })
    : completed >= total ? h('a', { class: 'btn btn-primary', href: dayRoute, text: 'Revisit the course' })
      : canGenerate ? fetchButton('Prepare next lesson', 'learn', new Date().toLocaleDateString('en-CA'), refresh)
        : h('a', { class: 'btn', href: '#/learning/notes', text: 'Open your learning notes' });

  root.append(coursePracticeTabs(),
    h('section', { class: 'course-start-panel', 'aria-label': 'Your next course lesson' },
      h('div', { class: 'course-start-copy' },
        h('p', { class: 'eyebrow', text: next ? `YOUR NEXT STEP · DAY ${next.day} / ${total}` : 'YOUR COURSE REVIEW' }),
        h('h2', { text: next ? `Day ${next.day}: ${next.title}` : 'Turn your practice into interview evidence.' }),
        h('p', { text: 'Study one connected lesson across four subjects. Understand the idea, trace an example, build something and explain your choices.' }),
        h('div', { class: 'course-start-actions' }, action,
          h('span', { text: 'Simple English · Around 3–4 hours · Your own pace' })),
        h('div', { class: 'course-hub-progress' },
          h('div', {}, h('strong', { text: `${completed} of ${total} days complete` }), h('span', { text: 'Progress follows your completed work.' })),
          h('progress', { max: total, value: completed, 'aria-label': 'Curriculum progress' }))),
      h('div', { class: 'course-today-outline' }, h('h3', { text: 'What you will learn today' }),
        today.length ? h('ol', {}, today.map((subject, index) => h('li', {},
          h('span', { class: 'course-subject-number', 'aria-hidden': 'true', text: String(index + 1).padStart(2, '0') }),
          h('div', {}, h('span', { class: 'course-subject-label', text: subject.title }),
            next.available ? h('a', { href: routeFor(next, PARTS[subject.key]), text: subject.topic }) : h('strong', { text: subject.topic }),
            subject.outcome ? h('p', { text: subject.outcome }) : null),
          h('small', { text: session.find(part => part.key === subject.key)?.minutes ? `${session.find(part => part.key === subject.key).minutes} min` : '' }))))
          : h('p', { text: 'Choose a lesson below to revisit its four subjects.' }))),
    next ? h('section', { class: 'course-output', 'aria-label': 'What to finish today' },
      h('div', {}, h('p', { class: 'eyebrow', text: 'FINISH TODAY WITH' }),
        h('h3', { text: next.deliverable || `A working example of ${next.full_stack || next.practice || 'today’s lesson'}` })),
      h('div', {}, h('span', { class: 'course-output-label', text: `Part of your Week ${currentWeek?.number || 1} project` }),
        h('p', { text: next.project || currentWeek?.project || 'Save your code, diagram, test results and explanation together.' }))) : document.createDocumentFragment());

  const weekList = h('div', { class: 'course-week-list' });
  const phaseSummary = h('p', { class: 'course-phase-summary', role: 'status' });
  const phaseButtons = [];
  function weekCard(week) {
    const days = week.days || [], isCurrent = week.number === currentWeek?.number;
    const details = h('details', { class: `course-week${isCurrent ? ' is-current' : ''}`, 'data-course-week': week.number,
      open: state.openWeeks.has(week.number), ontoggle: event => {
        if (event.currentTarget.open) state.openWeeks.add(week.number); else state.openWeeks.delete(week.number);
      } },
      h('summary', {}, h('span', { class: 'course-week-number', text: String(week.number).padStart(2, '0'), 'aria-hidden': 'true' }),
        h('span', { class: 'course-week-heading' }, h('strong', { text: `Week ${week.number} · ${week.title}` }),
          h('span', { text: `Days ${week.start_day}–${week.end_day}${isCurrent ? ' · Your current week' : ''}` })),
        h('span', { class: 'course-week-count', text: `${week.completed || 0} / ${days.length} complete` })),
      h('div', { class: 'course-week-project' }, h('span', { text: 'BUILD THIS WEEK' }), h('p', { text: week.project }),
        h('a', { href: `#/learning/weekly?view=questions&week=${week.number}`, text: 'Practise this week’s interview questions →' })),
      h('ol', { class: 'course-day-list' }, days.map(day => h('li', { class: `course-day${day.day === next?.day ? ' is-next' : ''}`, 'data-course-day': day.day },
        h('div', { class: 'course-day-name' }, h('span', { text: `DAY ${day.day}` }),
          h('strong', { text: day.title }), h('small', { text: day.read ? 'Complete' : day.day === next?.day ? 'Start here' : 'Ready when you are' })),
        h('dl', { class: 'course-day-subjects' }, (day.topics || []).map(subject => h('div', {},
          h('dt', { text: subject.title }), h('dd', { text: subject.topic })))),
        day.available ? h('a', { class: 'course-day-link', href: routeFor(day), text: day.read ? 'Review lesson →' : 'Open lesson →',
          'aria-label': `${day.read ? 'Review lesson' : 'Open lesson'} → Day ${day.day}: ${day.title}` })
          : h('span', { class: 'course-day-unavailable', text: day.reason || 'Prepare this lesson to begin.' })))));
    return details;
  }
  function drawPhase() {
    const phase = phases[state.phase];
    phaseButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === state.phase)));
    phaseSummary.textContent = `${phase.title} · Days ${phase.start_day}–${phase.end_day}. Open a week to see exactly what to study and build.`;
    weekList.replaceChildren(...weeks.filter(week => week.end_day >= phase.start_day && week.start_day <= phase.end_day).map(weekCard));
  }
  const phaseNav = h('div', { class: 'course-phase-nav', role: 'group', 'aria-label': 'Course phases' }, phases.map((phase, index) => {
    const button = h('button', { type: 'button', 'aria-pressed': String(index === state.phase), onclick: () => { state.phase = index; drawPhase(); } },
      h('span', { text: `PHASE ${index + 1} · DAYS ${phase.start_day}–${phase.end_day}` }), h('strong', { text: phase.title }));
    phaseButtons.push(button); return button;
  }));
  root.append(h('section', { class: 'course-roadmap-section', 'aria-label': 'Your 90-day syllabus' },
    h('div', { class: 'course-section-heading' }, h('div', {}, h('p', { class: 'eyebrow', text: 'KNOW WHAT COMES NEXT' }), h('h2', { text: 'Your 90-day syllabus' })),
      h('button', { class: 'btn', type: 'button', text: 'Go to my current week', onclick: () => {
        state.phase = activePhase; if (currentWeek) state.openWeeks.add(currentWeek.number); drawPhase();
        const week = weekList.querySelector(`[data-course-week="${currentWeek?.number}"]`);
        week?.querySelector('summary')?.focus({ preventScroll: true }); week?.scrollIntoView({ block: 'start' });
      } })), phaseNav, phaseSummary, weekList),
    h('section', { class: 'course-interview-map', 'aria-label': 'How the course prepares you for interviews' },
      h('div', { class: 'course-section-heading' }, h('div', {}, h('p', { class: 'eyebrow', text: 'LEARNING → PRACTICE → EVIDENCE' }),
        h('h2', { text: 'How this prepares you for interviews' }), h('p', { text: 'Use these outputs in coding, design and project discussions. Practise explaining the decisions behind your work.' }))),
      h('div', { class: 'course-skill-grid' }, TRACKS.map(([key, title, use, evidence]) => h('article', { 'data-course-skill': key },
        h('h3', { text: title }), h('p', { text: use }), h('h4', { text: 'Work to show' }), h('p', { text: evidence })))),
      h('p', { class: 'course-readiness', text: 'Before marking a day complete: explain the idea without notes, run your code against edge cases, and answer one follow-up question. Revisit anything you cannot yet explain.' }),
      h('details', { class: 'course-sources' }, h('summary', { text: 'Interview and learning guides behind this structure' }),
        h('ul', {}, [
          ['Amazon: SDE II interview preparation', 'https://www.amazon.jobs/content/en/how-we-hire/sde-ii-interview-prep'],
          ['Google: Machine Learning Crash Course', 'https://developers.google.com/machine-learning/crash-course/'],
          ['MDN: Core web development curriculum', 'https://developer.mozilla.org/en-US/curriculum/core/'],
        ].map(([title, href]) => h('li', {}, h('a', { href, target: '_blank', rel: 'noopener noreferrer', text: title })))))),
    h('nav', { class: 'course-tools', 'aria-label': 'More course resources' },
      h('a', { href: '#/learning/dsa', text: 'DSA coding practice →' }),
      h('a', { href: '#/learning/notes', text: 'My study notes →' }),
      canResearch ? h('a', { href: '#/learning/library?category=Learning', text: 'Saved learning →' }) : null,
      canGenerate ? h('a', { href: '#/learning/courses', text: 'Reference chapters →' }) : null));
  drawPhase();
  return root;
}
