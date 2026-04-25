/**
 * Simple wildcard pattern matching with memoization.
 *
 * `*` matches everything including spaces.
 * Case-sensitive. No regex special character handling.
 */
export function matches(pattern: string, input: string): boolean {
	if (pattern === '') {
		return input === '';
	}
	const segments = pattern.split('*');
	const memo = new Map<string, boolean>();
	return matchSegmentsMemo(segments, input, 0, 0, false, memo);
}

function matchSegmentsMemo(
	segments: string[],
	input: string,
	inputPos: number,
	segIdx: number,
	hasWildcard: boolean,
	memo: Map<string, boolean>,
): boolean {
	const memoKey = `${inputPos}|${segIdx}`;
	if (memo.has(memoKey)) {
		const result = memo.get(memoKey);
		if (result !== undefined) {
			return result;
		}
	}

	while (segIdx < segments.length) {
		const segment = segments[segIdx];

		if (segment === '') {
			// Empty segment from a `*`
			if (segIdx === segments.length - 1) {
				// Last segment is empty → pattern ends with `*`
				memo.set(memoKey, true);
				return true;
			}
			// Skip to next segment, mark wildcard as seen
			const result = matchSegmentsMemo(
				segments,
				input,
				inputPos,
				segIdx + 1,
				true,
				memo,
			);
			memo.set(memoKey, result);
			return result;
		}

		// Non-empty segment
		if (!hasWildcard) {
			// Before any `*`: must match at position 0
			if (!input.startsWith(segment, 0)) {
				memo.set(memoKey, false);
				return false;
			}
			if (segIdx === segments.length - 1) {
				// Last segment: must consume entire input
				const result = input.length === segment.length;
				memo.set(memoKey, result);
				return result;
			}
			const result = matchSegmentsMemo(
				segments,
				input,
				segment.length,
				segIdx + 1,
				true,
				memo,
			);
			memo.set(memoKey, result);
			return result;
		}

		// After `*`: try matching at every position from inputPos onward
		for (let i = inputPos; i <= input.length; i++) {
			if (input.startsWith(segment, i)) {
				if (
					matchSegmentsMemo(
						segments,
						input,
						i + segment.length,
						segIdx + 1,
						true,
						memo,
					)
				) {
					memo.set(memoKey, true);
					return true;
				}
			}
		}

		memo.set(memoKey, false);
		return false;
	}

	const result = inputPos === input.length;
	memo.set(memoKey, result);
	return result;
}
