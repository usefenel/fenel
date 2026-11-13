import { describe, expect, test } from "bun:test";
import { createSubjectMemo } from "./suggestion-subject-memo";

// A pasted picture: one plain record holding many pixel records.
const picture = (size: number) => ({ kind: "literal", value: { width: size, height: size,
  pixels: Array.from({ length: size * size }, (_, index) => ({ r: index % 256, g: 90, b: 140, a: 255 })) } });

/** The costly whole-data check, counted; verdicts shared per value object as
 * `sharedLiteralMembership` does within one membership. */
function countingMembership(counter: { calls: number }) {
  const verdicts = new WeakMap<object, boolean>();
  return (value: object) => {
    const known = verdicts.get(value);
    if (known !== undefined) return known;
    counter.calls += 1;
    verdicts.set(value, true);
    return true;
  };
}

describe("one whole-data check per subject and reader frame", () => {
  test("the list, every preview and the click check the picture once", () => {
    const memo = createSubjectMemo<ReturnType<typeof countingMembership>>();
    const frame = {}, owners = [{}, {}];
    const counter = { calls: 0 };
    // Each worker request receives its own transported copy of the same subject.
    for (let request = 0; request < 6; request++) {
      const transported = structuredClone(picture(16));
      const subject = memo.subject(frame, owners, transported, () => countingMembership(counter));
      const membership = memo.membershipFor(frame, owners, subject.value) ?? countingMembership(counter);
      expect(membership(subject.value)).toBe(true);
    }
    expect(counter.calls).toBe(1);
  });

  test("other bytes, another frame or other owners are another subject", () => {
    const memo = createSubjectMemo<string>();
    const frame = {}, owners = [{}];
    const first = memo.subject(frame, owners, picture(2), () => "first");
    expect(memo.subject(frame, owners, structuredClone(picture(2)), () => "again")).toBe(first);
    const changed = picture(2); changed.value.pixels[0]!.r = 7;
    expect(memo.subject(frame, owners, changed, () => "changed")).not.toBe(first);
    expect(memo.subject({}, owners, picture(2), () => "frame")).not.toBe(first);
    expect(memo.subject(frame, [{}], picture(2), () => "owners")).not.toBe(first);
    expect(memo.membershipFor({}, owners, first.value)).toBeUndefined();
  });

  test("the held subject is a private copy: a later edit of the request's own object changes nothing", () => {
    const memo = createSubjectMemo<string>();
    const frame = {}, owners = [{}];
    const original = picture(2);
    const held = memo.subject(frame, owners, original, () => "held");
    expect(held).not.toBe(original);
    original.value.pixels[0]!.r = 200;
    expect(held.value.pixels[0]!.r).toBe(0);
    expect(memo.membershipFor(frame, owners, original.value)).toBeUndefined();
    expect(memo.membershipFor(frame, owners, held.value.pixels[1])).toBe("held");
  });

  test("data that is not plain stays the request's own and is not held", () => {
    const memo = createSubjectMemo<string>();
    const odd = { kind: "literal", value: { run: () => 1 } };
    expect(memo.subject({}, [], odd, () => "odd")).toBe(odd);
  });
});
