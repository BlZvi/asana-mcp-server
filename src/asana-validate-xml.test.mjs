// Runnable self-check for the Asana rich-text XML validator.
// Run after `npm run build`:  node src/asana-validate-xml.test.mjs
import assert from "node:assert";
import { validateAsanaXml } from "../build/asana-validate-xml.js";

const mustReject = [
  ["<body><strong>hi</body>", "unclosed tag"],
  ["<body><em>x</strong></body>", "mismatched close"],
  ["<body>Tom & Jerry</body>", "raw ampersand"],
  ["<body>a &foo; b</body>", "unknown named entity"],
  ["<body><script>x</script></body>", "unsupported tag"],
];
const mustPass = [
  ["<body>a&nbsp;b</body>", "nbsp entity"],
  ["<body>Tom &amp; Jerry</body>", "escaped amp"],
  ["<body>50&deg; &mdash; hot</body>", "deg + mdash"],
  ["<body><strong>ok</strong> and <em>fine</em></body>", "well-formed"],
  ["<body>price &#8364;5</body>", "numeric entity"],
  ['<body><a href="http://x?y=1&amp;z=2">l</a></body>', "amp in url"],
];

for (const [xml, label] of mustReject) {
  assert(validateAsanaXml(xml).length > 0, `expected REJECT: ${label}`);
}
for (const [xml, label] of mustPass) {
  const errs = validateAsanaXml(xml);
  assert(errs.length === 0, `expected PASS: ${label} -> ${errs[0]}`);
}
console.log(
  `validateAsanaXml: ${mustReject.length + mustPass.length} cases OK`,
);
