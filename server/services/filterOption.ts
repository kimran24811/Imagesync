/**
 * FFmpeg <=7 accepted -filter_complex_script. FFmpeg 8 removed that
 * deprecated switch, replacing it with the generic -/filter_complex
 * file-indirection syntax. Do not inline large SceneSync master graphs:
 * Windows CreateProcess limits the entire argument string to ~32K chars.
 */
export type FilterFileOption = '-filter_complex_script' | '-/filter_complex';

export function chooseFilterFileOption(ffmpegVersion: string): FilterFileOption {
  const major = /^(?:n)?(\d+)(?:\D|$)/i.exec(ffmpegVersion.trim());
  return major && Number(major[1]) >= 8
    ? '-/filter_complex'
    : '-filter_complex_script';
}

export function alternateFilterFileOption(option: FilterFileOption): FilterFileOption {
  return option === '-filter_complex_script' ? '-/filter_complex' : '-filter_complex_script';
}

export function isUnsupportedFilterFileOption(
  error: unknown,
  option?: string
): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (!/unrecognized option|option not found/i.test(message)) return false;
  const optionNames = option
    ? [option.replace(/^-/, '')]
    : ['filter_complex_script', '/filter_complex'];
  return optionNames.some((name) => message.includes(name));
}
