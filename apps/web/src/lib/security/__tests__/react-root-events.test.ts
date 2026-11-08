/**
 * Regression: the global listener allowlist dropped React's own root
 * listeners. Next.js hydrates the document, so React registers its delegated
 * listeners on `document`; with `input` / `submit` / `mouseover` rejected,
 * every controlled text field ignored typing (comment box, playlist name,
 * search...) and form onSubmit handlers never ran.
 */
import { EventListenerValidator } from '../EventListenerValidator';
import { SecurityEventLogger } from '../SecurityEventLogger';

/** Event types react-dom listens to on its root container (the document under the App Router) */
const REACT_ROOT_EVENTS = [
  'input', 'change', 'submit', 'reset', 'invalid', 'beforeinput', 'compositionstart', 'compositionupdate',
  'compositionend', 'keypress', 'mouseover', 'mouseout', 'pointerover', 'pointerout', 'dblclick', 'select',
  'play', 'pause', 'ended', 'timeupdate', 'volumechange', 'toggle', 'animationstart', 'transitionstart',
];

function makeValidator() {
  const logger = new SecurityEventLogger({ batchSize: 1000, transport: async () => undefined });
  return new EventListenerValidator({ logger });
}

describe('React root listeners on document', () => {
  it('every event type React DOM listens to on its root is allowed', () => {
    const validator = makeValidator();
    const rejected = REACT_ROOT_EVENTS.filter((type) => !validator.validate(type, () => undefined).allowed);
    expect(rejected).toEqual([]);
  });

  it('an installed validator lets React-style input/submit listeners on document fire', () => {
    const validator = makeValidator();
    validator.install([document]);
    try {
      const seen: string[] = [];
      const reactLike = (event: Event) => seen.push(event.type);
      document.addEventListener('input', reactLike);
      document.addEventListener('submit', reactLike);
      document.dispatchEvent(new Event('input'));
      document.dispatchEvent(new Event('submit'));
      document.removeEventListener('input', reactLike);
      document.removeEventListener('submit', reactLike);
      expect(seen).toEqual(['input', 'submit']);
    } finally {
      validator.uninstall();
    }
  });
});
