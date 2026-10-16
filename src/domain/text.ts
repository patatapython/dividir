/**
 * Text people type or paste — names, concepts — cleaned the one way the whole app
 * stores it. A name pasted from a chat often carries invisible characters (WhatsApp
 * puts a word joiner U+2060 before list items); kept, "⁠Joana" would look like
 * "Joana" yet be another person, and a pasted group name could never be typed back.
 *
 * Removed: invisible format characters (soft hyphen, zero-width space, direction
 * marks and embeddings, word joiner and invisible operators, byte-order mark). Kept:
 * the zero-width joiners U+200C/U+200D, which glue emoji sequences and scripts.
 * Every run of whitespace (tabs, line breaks, non-breaking spaces) becomes one space,
 * the ends are trimmed, and accents are composed (NFC) so "Rubén" is one spelling.
 */
const INVISIBLE = /[­᠎​‎‏‪-‮⁠-⁤⁦-⁯﻿]/g;

export function normalizeText(raw: string): string {
  return raw.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

/**
 * When two names are the same person: equal once normalized, ignoring capitals.
 * Accents still count ("Rubén" ≠ "Ruben"). Mirrors the database backstop, a unique
 * index on ("groupId", lower(name)).
 */
export function personNameKey(name: string): string {
  return normalizeText(name).toLowerCase();
}
