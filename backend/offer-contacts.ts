export interface OfferContact {
  name: string;
  evidence: string;
}

// These are text clues, not LinkedIn tag or identity verification.
export function extractOfferContacts(snippet: string): OfferContact[] {
  const contacts: OfferContact[] = [];
  const seen = new Set<string>();
  const nameWord = String.raw`\p{Lu}[\p{L}\p{M}'\u2019-]+`;
  const fullName = String.raw`${nameWord}(?:\s+(?:(?:de|van|von|da|del)\s+)?${nameWord}){1,3}`;
  const role = String.raw`(?:[Rr]ecruiter|[Tt]alent [Aa]cquisition (?:[Pp]artner|[Ss]pecialist|[Rr]ecruiter))`;
  const patterns = [
    new RegExp(String.raw`\b(?:my|our|the|My|Our|The)\s+${role}\s*[,(:\-]?\s*@?(${fullName})`, "gu"),
    new RegExp(String.raw`\b${role}\s*[,(:\-]?\s*@?(${fullName})`, "gu"),
    new RegExp(String.raw`@?(${fullName})\s*[,\(\u2013\u2014-]\s*(?:my|our|the|a)\s+${role}\b`, "gu"),
  ];

  for (const pattern of patterns) {
    for (const match of snippet.matchAll(pattern)) {
      const name = match[1].trim();
      const key = name.toLowerCase();

      // Avoid common headings or team labels being treated as a person's name.
      if (/\b(?:Team|Recruiting|Acquisition|Resources|Thank|Thanks)\b/.test(name)) {
        continue;
      }

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      contacts.push({
        name,
        evidence: match[0].trim(),
      });
    }
  }

  return contacts;
}
