/**
 * Simple wildcard pattern matching.
 *
 * `*` matches everything including spaces.
 * Case-sensitive. No regex special character handling.
 */
export function matches(pattern: string, input: string): boolean {
	if (pattern === '') {
		return input === '';
	}
	const segments = pattern.split('*');
	return matchSegments(segments, input, 0, 0, false);
}

function matchSegments(
	segments: string[],
	input: string,
	inputPos: number,
	segIdx: number,
	hasWildcard: boolean,
): boolean {
	while (segIdx < segments.length) {
		const segment = segments[segIdx];

		if (segment === '') {
			// Empty segment from a `*`
			if (segIdx === segments.length - 1) {
				// Last segment is empty → pattern ends with `*`
				return true;
			}
			// Skip to next segment, mark wildcard as seen
			return matchSegments(segments, input, inputPos, segIdx + 1, true);
		}

		// Non-empty segment
		if (!hasWildcard) {
			// Before any `*`: must match at position 0
			if (!input.startsWith(segment, 0)) {
				return false;
			}
			return matchSegments(segments, input, segment.length, segIdx + 1, true);
		}

		// After `*`: try matching at every position from inputPos onward
		for (let i = inputPos; i <= input.length; i++) {
			if (input.startsWith(segment, i)) {
				if (
					matchSegments(segments, input, i + segment.length, segIdx + 1, true)
				) {
					return true;
				}
			}
		}

		return false;
	}

	return inputPos === input.length;
}
