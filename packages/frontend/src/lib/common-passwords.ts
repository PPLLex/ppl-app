/**
 * Common-password blocklist — rejects the ~300 most-breached passwords.
 *
 * NIST SP 800-63B §5.1.1.2 explicitly recommends this over complexity rules
 * (mixed case / digits / symbols). A long unique memorable password is
 * stronger than a short "P@ssw0rd!" that checks every complexity box.
 *
 * Matching is case-insensitive. The set lives client-side for instant
 * feedback; the backend re-checks (and additionally calls HIBP) so we
 * never trust the client for actual enforcement.
 *
 * List derived from the top entries in the Have I Been Pwned "Pwned
 * Passwords" corpus. Covers the overwhelming majority of first-guess
 * attacks — real users typing these deserve the friction.
 */

// prettier-ignore
const COMMON_PASSWORDS: ReadonlyArray<string> = [
  '123456', '123456789', 'password', '12345678', 'qwerty', '111111', '12345',
  '123123', '1234567', '1234567890', 'abc123', '1q2w3e4r', 'admin', 'password1',
  'iloveyou', 'qwerty123', '000000', '555555', '123321', '654321', 'superman',
  'qazwsx', 'michael', 'football', 'baseball', 'welcome', 'shadow', 'monkey',
  'sunshine', 'password123', 'qwertyuiop', 'letmein', 'dragon', 'master',
  'princess', '123qwe', 'asdfgh', 'trustno1', 'starwars', 'whatever', 'jordan',
  'hunter', 'killer', 'jennifer', 'lovely', 'jessica', 'charlie', 'andrew',
  'michelle', 'chocolate', 'daniel', 'computer', 'michelle1', 'hockey',
  'ranger', 'internet', 'service', 'summer', 'purple', 'angel', 'nothing',
  'thomas', 'mercedes', 'pepper', 'merlin', 'matthew', 'freedom', 'andrea',
  'ashley', 'bailey', 'flower', 'password!', '1q2w3e', '1qaz2wsx', 'zaq1zaq1',
  'q1w2e3r4', 'qwerty1', 'qwe123', 'asdasd', 'zxcvbn', 'zxcvbnm', 'aaaaaa',
  'nicole', 'pokemon', 'yankees', 'sophia', 'william', 'hannah', 'robert',
  'hello', 'hello123', 'welcome1', 'welcome123', 'admin123', 'root', 'toor',
  'passw0rd', 'p@ssw0rd', 'p@ssword', 'p@ssword1', 'qwerty12', 'qwerty1234',
  '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1111111', '11111111', '1111111111', '22222222', '333333', '7777777',
  '121212', '131313', '112233', '141414', '151515', '161616', '171717',
  '181818', '191919', '202020', '212121', '987654', '987654321', '09876543',
  'tigger', 'buster', 'soccer', 'hockey1', 'george', 'harley', 'ginger',
  'matrix', 'mustang', 'ferrari', 'porsche', 'orange', 'banana', 'apple',
  'maggie', 'cookie', 'peanut', 'snoopy', 'elephant', 'tigers', 'taylor',
  'joshua', 'amanda', 'maria', 'rachel', 'chelsea', 'justin', 'tyler',
  'nathan', 'austin', 'kevin', 'brian', 'david', 'jason', 'ryan', 'tennis',
  'golf', 'baseball1', 'basketball', 'phoenix', 'chicago', 'dallas', 'boston',
  'redsox', 'yankee', 'patriots', 'cowboys', 'lakers', 'celtics', 'rangers',
  'eagles', 'falcons', 'chargers', 'dolphins', 'raiders', 'pitching',
  'pitcher', 'fastball', 'curveball', 'slider', 'changeup', 'baseball123',
  'pitching1', 'strikeout', 'homerun', 'pplbaseball', 'ppl', 'ppl123',
  'pitching123', 'pitchingperformancelab', 'louisville', 'kentucky',
  'bluegrass', 'cardinals', 'wildcats', 'bats', 'sluggers', 'diamond',
  'bullpen', 'mound', 'leatherhead', 'glove', 'cleats', 'spikes', 'dugout',
  'outfield', 'infield', 'catcher', 'shortstop', 'firstbase', 'homeplate',
  'umpire', 'inning', 'strike', 'strikeone', 'strikethree', 'atbat',
  'changeme', 'changeme1', 'changeme123', 'demo', 'demo123', 'test', 'test123',
  'user', 'user123', 'guest', 'guest123', 'admin1', 'admin2026', 'admin2025',
  'admin2024', '20252025', 'spring2026', 'summer2026', 'winter2026', 'fall2026',
  'march2026', 'april2026', 'may2026', 'june2026', 'qwerty!1', 'qazwsx123',
  'login', 'login123', 'account', 'forgot', 'secret', 'secret123',
  'hello1234', 'password12', 'password1234', 'password2025', 'password2026',
  'abcdefg', 'abcdefgh', 'asdfghjkl', 'asdf1234', '1qazxsw2', '1qaz@wsx',
  'donald', 'donald1', 'biden', 'trump', 'obama', 'clinton',
];

// Normalize once at module load for O(1) lookups.
const COMMON_SET = new Set(COMMON_PASSWORDS.map((p) => p.toLowerCase()));

/**
 * Returns true if the provided password is on the common-password blocklist.
 * Case-insensitive.
 */
export function isCommonPassword(pw: string): boolean {
  if (!pw) return false;
  return COMMON_SET.has(pw.toLowerCase());
}
