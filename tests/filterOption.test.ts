import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseFilterFileOption,
  alternateFilterFileOption,
  isUnsupportedFilterFileOption,
} from '../server/services/filterOption.ts';

test('legacy FFmpeg 4, 6, and 7 use filter_complex_script file mode', () => {
  for (const version of ['4.4.2', '6.1', '7.1.5', 'n7.0', 'Unknown']) {
    assert.equal(chooseFilterFileOption(version), '-filter_complex_script');
  }
});

test('FFmpeg 8+ uses the new file-loading filter_complex syntax', () => {
  for (const version of ['8.0', 'n8.0.1', '9.0']) {
    assert.equal(chooseFilterFileOption(version), '-/filter_complex');
  }
});

test('switch only on unsupported option messages', () => {
  const oldOptionError = new Error(
    "ffmpeg exited with code 2880417800: Unrecognized option 'filter_complex_script'. Error splitting the argument list: Option not found"
  );
  assert.ok(isUnsupportedFilterFileOption(oldOptionError, '-filter_complex_script'));
  assert.equal(alternateFilterFileOption('-filter_complex_script'), '-/filter_complex');

  const newOptionError = new Error("Unrecognized option '/filter_complex'.");
  assert.ok(isUnsupportedFilterFileOption(newOptionError, '-/filter_complex'));
  assert.equal(alternateFilterFileOption('-/filter_complex'), '-filter_complex_script');

  const unrelatedError = new Error('Error while filtering: Cannot allocate memory');
  assert.equal(isUnsupportedFilterFileOption(unrelatedError), false);
  assert.equal(isUnsupportedFilterFileOption(newOptionError, '-filter_complex_script'), false);
});
