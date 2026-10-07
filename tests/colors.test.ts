import test from "node:test";
import assert from "node:assert/strict";
import {
  addFavoriteColor,
  FAVORITE_COLOR_LIMIT,
  readFavoriteColors,
  removeFavoriteColor
} from "../src/colors";

test("favorite colors provide the requested defaults for existing installations", () => {
  assert.deepEqual(readFavoriteColors(undefined), {
    text: ["#ffffff"],
    background: ["#2483ff"]
  });
  assert.deepEqual(readFavoriteColors({}), {
    text: ["#ffffff"],
    background: ["#2483ff"]
  });
});

test("favorite colors normalize, deduplicate and reject malformed saved values", () => {
  const colors = readFavoriteColors({
    text: ["#FFFFFF", "#ffffff", "#24252B", "red", 42],
    background: []
  });
  assert.deepEqual(colors.text, ["#ffffff", "#24252b"]);
  assert.deepEqual(colors.background, []);
});

test("favorite colors can be added and removed without mutating the source", () => {
  const initial = readFavoriteColors(undefined);
  const added = addFavoriteColor(initial, "text", "#24252B");
  assert.deepEqual(initial.text, ["#ffffff"]);
  assert.deepEqual(added.text, ["#ffffff", "#24252b"]);
  assert.equal(addFavoriteColor(added, "text", "#24252B"), added);
  assert.deepEqual(removeFavoriteColor(added, "text", "#FFFFFF").text, ["#24252b"]);
});

test("favorite color lists keep the first twelve valid unique colors", () => {
  const values = Array.from({ length: FAVORITE_COLOR_LIMIT + 3 }, (_, index) =>
    `#${index.toString(16).padStart(6, "0")}`);
  const colors = readFavoriteColors({ text: values, background: values });
  assert.equal(colors.text.length, FAVORITE_COLOR_LIMIT);
  assert.equal(colors.background.length, FAVORITE_COLOR_LIMIT);
  assert.equal(addFavoriteColor(colors, "text", "#abcdef"), colors);
});
