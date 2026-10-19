import { load } from "cheerio";
import { PostingError } from "./posting-page";

type JsonObject = Record<string, unknown>;

export interface JobDetails {
  title: string;
  company: string;
  locations: string[];
  team: string;
  description: string;
  sourceUrl: string;
  warnings: string[];
}

function asObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }

  return {};
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  return value === undefined ? [] : [value];
}

function text(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const fragment = load(value);
  fragment("script, style, noscript").remove();
  fragment("br").replaceWith("\n");
  fragment("p, li, div").append("\n");

  return fragment.root().text()
    .replace(/[\t \u00a0]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
}

function namedText(value: unknown): string {
  if (typeof value === "string") {
    return text(value);
  }

  return text(asObject(value).name);
}

// JSON-LD may be an object, an array, or nested inside an @graph.
function findJobPostings(value: unknown, jobs: JsonObject[], depth = 0): void {
  if (depth > 20 || !value || typeof value !== "object") {
    return;
  }

  const object = asObject(value);
  const types = asArray(object["@type"]);

  if (types.some((type) => typeof type === "string" && /(^|\/)JobPosting$/.test(type))) {
    jobs.push(object);
    return;
  }

  for (const child of Object.values(value)) {
    findJobPostings(child, jobs, depth + 1);
  }
}

function locationText(value: unknown): string {
  if (typeof value === "string") {
    return text(value);
  }

  const place = asObject(value);
  const addressValue = place.address || place;

  if (typeof addressValue === "string") {
    return text(addressValue);
  }

  const address = asObject(addressValue);
  const parts = [
    text(address.addressLocality),
    text(address.addressRegion),
    namedText(address.addressCountry),
  ];

  return parts.filter(Boolean).join(", ") || namedText(place);
}

export function parseJobPosting(html: string, sourceUrl: string): JobDetails {
  const $ = load(html);
  const jobs: JsonObject[] = [];

  $('script[type="application/ld+json"]').each((_index, element) => {
    try {
      findJobPostings(JSON.parse($(element).text()), jobs);
    } catch {
      // A malformed metadata block shouldn't prevent HTML fallbacks.
    }
  });

  let structured: JsonObject = jobs[0] || {};

  if (jobs.length > 1) {
    const matches = jobs.filter((job) => {
      const link = job.url || asObject(job.mainEntityOfPage)["@id"];

      try {
        const candidate = new URL(String(link), sourceUrl);
        const current = new URL(sourceUrl);
        return candidate.origin === current.origin && candidate.pathname === current.pathname;
      } catch {
        return false;
      }
    });

    if (matches.length !== 1) {
      throw new PostingError("This page lists multiple jobs. Paste a link to one specific posting.", 422);
    }

    structured = matches[0];
  }

  $("script, style, noscript, nav, footer, [hidden]").remove();

  // Prefer standard microdata if present; otherwise use page-wide fallbacks.
  const jobScope = $('[itemtype$="/JobPosting"]').first();
  const scope = jobScope.length ? jobScope : $("html");

  function field(selector: string): string {
    const element = scope.find(selector).first();
    return text(element.attr("content") || element.html() || "");
  }

  function meta(name: string): string {
    return text($(`meta[property="${name}"], meta[name="${name}"]`).first().attr("content"));
  }

  function labeledValue(label: RegExp): string {
    let result = "";

    scope.find("dt, p, li").each((_index, element) => {
      const node = $(element);
      const value = text(node.html() || "");
      const match = value.match(label);

      if (!result && match) {
        result = match[1]?.trim() || text(node.next("dd").html() || "");
      }
    });

    return result;
  }

  function descriptionSection(): string {
    let result = "";

    scope.find("h2, h3").each((_index, element) => {
      if (result || !/^(job description|description|about (the|this) (job|role)|the role)$/i.test($(element).text().trim())) {
        return;
      }

      const siblings = $(element).nextUntil("h1, h2, h3");
      result = siblings.map((_i, sibling) => text($(sibling).html() || "")).get().join("\n\n");
    });

    return result;
  }

  const title = text(structured.title)
    || field('[itemprop="title"]')
    || field("h1")
    || meta("og:title");

  const company = namedText(structured.hiringOrganization)
    || field('[itemprop="hiringOrganization"] [itemprop="name"]')
    || field('[itemprop="hiringOrganization"]')
    || labeledValue(/^(?:company|employer)(?:\s*:\s*(.*)|\s*)$/i)
    || labeledValue(/^Job (?:ID|number):\s*[^|\n]+\|\s*(.+)$/i);

  const description = text(structured.description)
    || field('[itemprop="description"]')
    || descriptionSection()
    || meta("og:description")
    || meta("description");

  let locations = asArray(structured.jobLocation).map(locationText).filter(Boolean);

  if (!locations.length) {
    locations = scope.find('[itemprop="jobLocation"]')
      .map((_index, element) => text($(element).attr("content") || $(element).html() || ""))
      .get()
      .filter(Boolean);
  }

  if (!locations.length) {
    // Accessibility labels are useful across differently styled websites.
    locations = scope.find('[aria-label="location"], [aria-label="Location"]')
      .parent().find("li")
      .map((_index, element) => text($(element).html() || ""))
      .get().filter(Boolean);
  }

  if (!locations.length) {
    const location = labeledValue(/^(?:location|locations|job location)(?:\s*:\s*(.*)|\s*)$/i);

    if (location) {
      locations.push(location);
    }
  }

  if (structured.jobLocationType === "TELECOMMUTE") {
    locations.unshift("Remote");
  }

  const team = namedText(structured.employmentUnit)
    || field('[itemprop="employmentUnit"]')
    || labeledValue(/^(?:team|department)(?:\s*:\s*(.*)|\s*)$/i)
    || text(scope.find('[aria-label="team"], [aria-label="Team"]').parent().find("a").first().html() || "");

  const pageText = $.root().text();
  const hasJobEvidence = jobs.length > 0 || jobScope.length > 0
    || /qualifications|responsibilities|apply (now|for|to)|job (id|description)/i.test(pageText);

  if (!hasJobEvidence || !title || description.length < 80) {
    throw new PostingError("Couldn't extract a job posting from this page. It may require JavaScript, sign-in, or a different posting link.", 422);
  }

  const warnings: string[] = [];

  if (!jobs.length) {
    warnings.push("Read from page content; review the extracted details.");
  }

  if (!company || !locations.length) {
    warnings.push("Some details weren't explicitly provided and are shown as Not listed.");
  }

  return {
    title,
    company,
    locations: [...new Set(locations)],
    team,
    description,
    sourceUrl,
    warnings,
  };
}

