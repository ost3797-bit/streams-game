/**
 * 스트림스 게임 덱 생성 (총 40장)
 * - 1~30 숫자 타일 (각 1장)
 * - 11~19 중복 숫자 타일 (각 1장 추가)
 * - 조커 타일 '★' (1장)
 */
export function generateDeck() {
  const deck = [];
  
  // 1부터 30까지 각 1장
  for (let i = 1; i <= 30; i++) {
    deck.push(i);
  }
  
  // 11부터 19까지 추가로 1장씩 (중복)
  for (let i = 11; i <= 19; i++) {
    deck.push(i);
  }
  
  // 조커 타일 추가
  deck.push('★');
  
  // Fisher-Yates 셔플
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  
  return deck;
}

/**
 * 조커('★')를 고려하여 보드판(크기 20)에서 가장 긴 비내림차순 스트림의 길이를 계산합니다.
 * @param {Array} board - 20개의 원소를 가진 배열 (숫자 또는 '★', 빈 칸은 null 또는 undefined)
 * @returns {number} 가장 긴 스트림의 길이
 */
export function getBestStreamLength(board) {
  // 빈 칸이 있다면 제외하고 채워진 부분만으로 계산하거나, 
  // 실제 게임에서는 20칸이 모두 찼을 때 호출되므로 board의 크기는 20입니다.
  const validBoard = board.map(x => (x === undefined || x === null ? '' : x));
  
  let maxLen = 0;
  const N = validBoard.length;
  
  // Contiguous subarray를 모두 탐색하며 비내림차순을 이룰 수 있는지 확인
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      const subarray = validBoard.slice(i, j + 1);
      
      // 조커를 제외한 알맹이 숫자들만 추출
      const nonJokers = subarray.filter(x => x !== '★' && x !== '');
      
      // 조커 제외 숫자들이 오름차순(비내림차순)을 유지하는지 검사
      let isNonDecreasing = true;
      for (let k = 1; k < nonJokers.length; k++) {
        if (Number(nonJokers[k]) < Number(nonJokers[k - 1])) {
          isNonDecreasing = false;
          break;
        }
      }
      
      // 유효하다면 길이를 계산하여 최댓값 갱신
      if (isNonDecreasing) {
        const len = j - i + 1;
        if (len > maxLen) {
          maxLen = len;
        }
      }
    }
  }
  
  return maxLen;
}

// 스트림 길이에 따른 점수 기준표
export const SCORE_MAP = {
  1: 0,
  2: 1,
  3: 3,
  4: 5,
  5: 7,
  6: 9,
  7: 11,
  8: 15,
  9: 20,
  10: 25,
  11: 30,
  12: 35,
  13: 40,
  14: 50,
  15: 60,
  16: 70,
  17: 85,
  18: 100,
  19: 150,
  20: 300
};

/**
 * 스트림 길이에 따른 점수를 반환합니다.
 * @param {number} streamLength - 스트림 길이
 * @returns {number} 점수
 */
export function getScore(streamLength) {
  return SCORE_MAP[streamLength] || 0;
}

/**
 * 빈 칸을 구분선(Break)으로 삼아, 현재 배치된 타일들만으로 구성할 수 있는 가장 긴 오름차순 스트림 정보 및 예측 점수 합을 구합니다.
 * @param {Array} board - 20개의 원소를 가진 배열 (숫자, '★', 또는 null/undefined)
 * @returns {Object} { maxStreamLen, totalScore }
 */
export function getCurrentPredictionInfo(board) {
  let totalScore = 0;
  let maxStreamLen = 0;
  let currentSegment = [];
  
  const processSegment = (segment) => {
    if (segment.length === 0) return;
    const res = calculateBestStreams(segment);
    totalScore += res.totalScore;
    const segMaxLen = res.streams.reduce((max, s) => Math.max(max, s.length), 0);
    if (segMaxLen > maxStreamLen) {
      maxStreamLen = segMaxLen;
    }
  };

  for (let i = 0; i < board.length; i++) {
    const val = board[i];
    if (val !== null && val !== undefined && val !== '') {
      currentSegment.push(val);
    } else {
      processSegment(currentSegment);
      currentSegment = [];
    }
  }
  processSegment(currentSegment);

  return {
    maxStreamLen,
    totalScore
  };
}

/**
 * 조커('★') 및 빈 칸을 고려하여 보드판(또는 부분 구간)을 최적의 비내림차순 스트림들로 분할합니다.
 * @param {Array} board - 숫자 또는 '★'가 담긴 배열
 * @returns {Object} { totalScore, streams }
 */
export function calculateBestStreams(board) {
  const validBoard = board.map(x => (x === undefined || x === null ? '' : x));
  const N = validBoard.length;
  
  // 1. 단일 구간 [p, k-1]이 유효한 비내림차순 스트림인지 체크하는 헬퍼 함수
  const isValidStream = (subarray) => {
    // 조커와 빈 문자열을 제외하고 순수한 숫자값들만 추출
    const nonJokers = subarray.filter(x => x !== '★' && x !== '');
    for (let k = 1; k < nonJokers.length; k++) {
      if (Number(nonJokers[k]) < Number(nonJokers[k - 1])) {
        return false;
      }
    }
    return true;
  };
  
  // 2. DP 테이블 선언
  // dp[k] : 0번부터 k-1번 인덱스까지의 보드를 최적으로 분할했을 때 얻을 수 있는 최대 점수
  const dp = Array(N + 1).fill(0);
  // parent[k] : dp[k]의 최적 분할 시작점 p (역추적용)
  const parent = Array(N + 1).fill(-1);
  
  for (let k = 1; k <= N; k++) {
    let maxVal = -1;
    let bestP = -1;
    for (let p = 0; p < k; p++) {
      const subarray = validBoard.slice(p, k);
      if (isValidStream(subarray)) {
        const len = k - p;
        const score = SCORE_MAP[len] || 0;
        const currentTotal = dp[p] + score;
        if (currentTotal > maxVal) {
          maxVal = currentTotal;
          bestP = p;
        }
      }
    }
    dp[k] = maxVal >= 0 ? maxVal : 0;
    parent[k] = bestP;
  }
  
  // 3. 역추적을 통한 스트림 구간 추출
  const streams = [];
  let curr = N;
  while (curr > 0) {
    const p = parent[curr];
    if (p === -1 || p === curr) {
      // 분할 불가능한 예외 케이스 방지
      break;
    }
    const len = curr - p;
    streams.unshift({
      startIndex: p,
      endIndex: curr - 1,
      length: len,
      score: SCORE_MAP[len] || 0,
      values: validBoard.slice(p, curr)
    });
    curr = p;
  }
  
  return {
    totalScore: dp[N],
    streams: streams
  };
}

// 하위 호환성을 위해 유지하는 기존 예측 함수
export function getCurrentPrediction(board) {
  const info = getCurrentPredictionInfo(board);
  return info.maxStreamLen;
}


