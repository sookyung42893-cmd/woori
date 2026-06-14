/* =========================================================
   "우리 (WooRi)" 부부 관계 증진 프로그램 - 데모 스크립트
   ========================================================= */

const TYPE_DELTA = {
  empathy:   { intimacy: +3, trust: +2, cooperation: +2, communication: +3, boundary: +2 },
  criticism: { intimacy: -2, trust: -3, cooperation:  0, communication: -4, boundary: -2 },
  avoidance: { intimacy: -1, trust:  0, cooperation: -2, communication: -2, boundary: -1 },
};

// 플레이어의 선택 유형에 따라 AI 파트너가 어떤 유형으로 반응할지에 대한 가중치
const AI_RESPONSE_WEIGHTS = {
  empathy:   { empathy: 0.6,  avoidance: 0.25, criticism: 0.15 },
  criticism: { criticism: 0.45, avoidance: 0.35, empathy: 0.2 },
  avoidance: { avoidance: 0.5, criticism: 0.25, empathy: 0.25 },
};

const TURN_ORDER = ['A1', 'B1', 'A2', 'B2', 'A3', 'B3'];

// 각 선택지를 Gottman/Bowen 분석 태그로 매핑하는 규칙 테이블
// (turn side: A턴=스스로 꺼낸 말, B턴=상대 말에 대한 반응) + type + slot 기준
const PATTERN_TAGS = {
  A: {
    empathy: {
      a: { gottman: '공감', bowen: ['분화된반응', '직접표현'] },
      b: { gottman: '공감', bowen: ['직접표현'] },
      c: { gottman: '공감', bowen: ['직접표현'] },
      d: { gottman: '공감', bowen: ['직접표현'] },
    },
    avoidance: {
      a: { gottman: '중립', bowen: [] },
      b: { gottman: '중립', bowen: ['간접표현'] },
      c: { gottman: '담쌓기', bowen: ['정서적단절'] },
      d: { gottman: '담쌓기', bowen: ['정서적단절'] },
    },
    criticism: {
      a: { gottman: '비난', bowen: ['정서적융합'] },
      b: { gottman: '비난', bowen: ['정서적융합', '간접표현'] },
      c: { gottman: '비난', bowen: ['정서적융합', '간접표현'] },
      d: { gottman: '비난', bowen: ['정서적융합'] },
    },
    default: {
      empathy: { gottman: '공감', bowen: ['직접표현'] },
      avoidance: { gottman: '중립', bowen: [] },
      criticism: { gottman: '비난', bowen: ['정서적융합'] },
    },
  },
  B: {
    empathy: {
      a: { gottman: '공감', bowen: ['분화된반응', '직접표현'] },
      b: { gottman: '공감', bowen: ['직접표현'] },
      c: { gottman: '공감', bowen: ['직접표현'] },
      d: { gottman: '공감', bowen: ['직접표현'] },
    },
    avoidance: {
      a: { gottman: '중립', bowen: [] },
      b: { gottman: '중립', bowen: ['간접표현'] },
      c: { gottman: '담쌓기', bowen: ['정서적단절'] },
      d: { gottman: '담쌓기', bowen: ['정서적단절'] },
    },
    criticism: {
      a: { gottman: '방어', bowen: ['정서적융합'] },
      b: { gottman: '방어', bowen: ['정서적융합', '간접표현'] },
      c: { gottman: '방어', bowen: ['정서적융합', '간접표현'] },
      d: { gottman: '방어', bowen: ['정서적융합'] },
    },
    default: {
      empathy: { gottman: '공감', bowen: ['직접표현'] },
      avoidance: { gottman: '중립', bowen: [] },
      criticism: { gottman: '방어', bowen: ['정서적융합', '간접표현'] },
    },
  },
};

// 텍스트 기반 override - 의미가 애매한 침묵/회피류 선택지를 별도 지정
const BOWEN_TEXT_OVERRIDES = {
  '(아무 말 없이 기다린다)': { gottman: '중립', bowen: ['분화된반응'] },
  '...(아무 말 없이 기다린다)': { gottman: '중립', bowen: ['분화된반응'] },
  '… (침묵 유지)': { gottman: '담쌓기', bowen: ['정서적단절'] },
  '(눈치 못 채고 각자 핸드폰)': { gottman: '담쌓기', bowen: ['정서적단절'] },
  '...됐어. (방으로 들어감)': { gottman: '담쌓기', bowen: ['정서적단절'] },
  '(그냥 둔다)': { gottman: '중립', bowen: ['정서적단절'] },
};

// 선택지 하나의 Gottman/Bowen 태그를 derive
function derivePatternTags(option, turnKey) {
  if (BOWEN_TEXT_OVERRIDES[option.text]) return BOWEN_TEXT_OVERRIDES[option.text];
  const side = turnKey[0]; // 'A' | 'B'
  const sideTable = PATTERN_TAGS[side];
  return (option.slot && sideTable[option.type][option.slot]) || sideTable.default[option.type];
}

const TURN_PROMPT = {
  A1: (n, situation) => `${situation}\n\n${n.A}님, 어떻게 반응할까요?`,
  A2: (n) => `${n.B}의 대답을 들은 ${n.A}. 다시 한 번 반응해볼까요?`,
  A3: (n) => `${n.B}의 대답을 들은 ${n.A}. 마지막으로 한 번 더 반응해볼까요?`,
};

/* =========================================================
   시나리오 데이터
   난이도(difficulty)는 1(쉬움) ~ 3(어려움)이며,
   진행된 Day가 늘어날수록 더 높은 난이도의 상황이 등장합니다.
   ========================================================= */
const SCENARIO_POOL = [
  {
    id: 'dishes',
    difficulty: 1,
    title: '쌓여있는 설거지',
    icon: '🍽️',
    desc: '공감과 비난의 차이가 명확한 일상 속 갈등',
    room: { key: 'kitchen', label: '주방', icon: '🍳', statKey: 'cooperation' },
    bg: 'bg_kitchen.png',
    situation: n => `퇴근하고 돌아온 ${n.A}가 보니, 싱크대에 어젯밤 설거지가 그대로 쌓여 있어요.`,
    A1: [
      { type: 'empathy',   slot: 'a', text: '오늘 많이 바빴어? 설거지 같이 할까.' },
      { type: 'criticism', slot: 'b', text: '설거지 오늘 안 한 거야?' },
      { type: 'avoidance', slot: 'c', text: '나 들어오기 전에 못 봤어?' },
      { type: 'criticism', slot: 'd', text: '또 이렇게 뒀네.' },
    ],
    B1: {
      a: [
        { type: 'empathy',   slot: 'a', text: '미안, 오늘 너무 지쳐서. 같이 하자.' },
        { type: 'avoidance', slot: 'b', text: '어… 내가 할게. 잠깐만.' },
        { type: 'avoidance', slot: 'c', text: '아니야, 내가 할게.' },
        { type: 'avoidance', slot: 'd', text: '괜찮아, 그냥 내가 해. (퉁명스럽게)' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '응, 미안. 오늘 좀 힘들었어.' },
        { type: 'avoidance', slot: 'b', text: '하려고 했는데 깜빡했어.' },
        { type: 'criticism', slot: 'c', text: '지금 하면 되잖아.' },
        { type: 'criticism', slot: 'd', text: '왜? 뭐가 문제야.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '봤는데 쉬고 나서 하려고 했어. 미안.' },
        { type: 'avoidance', slot: 'b', text: '봤지, 나중에 하려고.' },
        { type: 'empathy',   slot: 'c', text: '지금 할게.' },
        { type: 'criticism', slot: 'd', text: '내가 다 해야 해?' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '미안해. 오늘 진짜 힘들었어.' },
        { type: 'criticism', slot: 'b', text: '나도 오늘 힘들었거든.' },
        { type: 'empathy',   slot: 'c', text: '알겠어, 지금 할게.' },
        { type: 'criticism', slot: 'd', text: '맨날 그 소리.' },
      ],
    },
    A2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '아니야, 나도 지쳤는데. 같이 빨리 끝내자.' },
        { type: 'empathy',   slot: 'b', text: '그래, 내가 씻을게.' },
        { type: 'empathy',   slot: 'c', text: '오늘 많이 힘들었어? 무슨 일 있었어?' },
        { type: 'criticism', slot: 'd', text: '맨날 지쳐서라고 하면 어떡해.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '언제 할 것 같아? 나도 도울게.' },
        { type: 'avoidance', slot: 'b', text: '알겠어.' },
        { type: 'empathy',   slot: 'c', text: '그럼 같이 나중에 하자.' },
        { type: 'criticism', slot: 'd', text: '나중에가 언제야.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '아니야, 같이 하자.' },
        { type: 'avoidance', slot: 'b', text: '그래? 그럼 부탁할게.' },
        { type: 'empathy',   slot: 'c', text: '괜찮아?' },
        { type: 'criticism', slot: 'd', text: '처음부터 그랬으면 됐잖아.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '화난 게 아니야. 같이 하자고.' },
        { type: 'avoidance', slot: 'b', text: '…알겠어.' },
        { type: 'criticism', slot: 'c', text: '왜 그렇게 말해.' },
        { type: 'criticism', slot: 'd', text: '그래서 맨날 나만 하잖아.' },
      ],
    },
    B2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '그러자. 나 씻을게.' },
        { type: 'avoidance', slot: 'b', text: '응.' },
        { type: 'empathy',   slot: 'c', text: '미안, 내가 먼저 할게.' },
        { type: 'avoidance', slot: 'd', text: '됐어, 내가 할게.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '응, 금방 할게. 기다려줘.' },
        { type: 'avoidance', slot: 'b', text: '어.' },
        { type: 'empathy',   slot: 'c', text: '고마워.' },
        { type: 'criticism', slot: 'd', text: '이제야 말하네.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '고마워. 나 오늘 진짜 방전됐어.' },
        { type: 'empathy',   slot: 'b', text: '응, 빨리 끝내자.' },
        { type: 'avoidance', slot: 'c', text: '아니야, 내가 할게.' },
        { type: 'avoidance', slot: 'd', text: '같이 안 해도 돼.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '맞아, 미안해. 다음엔 미리 할게.' },
        { type: 'avoidance', slot: 'b', text: '그럴게.' },
        { type: 'criticism', slot: 'c', text: '나도 피곤했어.' },
        { type: 'criticism', slot: 'd', text: '강요하지 마.' },
      ],
    },
    A3: {
      a: [
        { type: 'empathy',   slot: 'a', text: '오늘 많이 힘들었구나. 씻고 나서 얘기하자.' },
        { type: 'avoidance', slot: 'b', text: '응, 알겠어.' },
        { type: 'empathy',   slot: 'c', text: '고마워.' },
        { type: 'criticism', slot: 'd', text: '맨날 방전이야.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '그래, 나도 도울게.' },
        { type: 'avoidance', slot: 'b', text: '응.' },
        { type: 'criticism', slot: 'c', text: '다음엔 미리 말해줘.' },
        { type: 'criticism', slot: 'd', text: '맨날 이렇게 하면 나도 힘들어.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '그래, 나도 도울게.' },
        { type: 'avoidance', slot: 'b', text: '응.' },
        { type: 'criticism', slot: 'c', text: '다음엔 미리 말해줘.' },
        { type: 'criticism', slot: 'd', text: '맨날 이렇게 하면 나도 힘들어.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '강요 아니야. 그냥 같이 하고 싶었어.' },
        { type: 'avoidance', slot: 'b', text: '…알겠어.' },
        { type: 'avoidance', slot: 'c', text: '그냥 넘기자.' },
        { type: 'criticism', slot: 'd', text: '그럼 앞으로 내가 다 할게.' },
      ],
    },
    B3: {
      a: [
        { type: 'empathy',   text: '응, 씻고 나서 오늘 얘기 들려줄게.' },
        { type: 'empathy',   text: '어, 그러자.' },
        { type: 'empathy',   text: '고마워, 미안해.' },
        { type: 'avoidance', text: '됐어.' },
      ],
      b: [
        { type: 'empathy',   text: '응, 다음엔 미리 말할게.' },
        { type: 'avoidance', text: '알겠어.' },
        { type: 'empathy',   text: '미안.' },
        { type: 'avoidance', text: '알아서 할게.' },
      ],
      c: [
        { type: 'empathy',   text: '응, 다음엔 미리 말할게.' },
        { type: 'avoidance', text: '알겠어.' },
        { type: 'empathy',   text: '미안.' },
        { type: 'avoidance', text: '알아서 할게.' },
      ],
      d: [
        { type: 'empathy',   text: '그러지 마. 같이 하자.' },
        { type: 'avoidance', text: '…그래.' },
        { type: 'empathy',   text: '나도 미안해.' },
        { type: 'avoidance', text: '그래, 알아서 해.' },
      ],
    },
  },



  {
    id: 'late_contact',
    difficulty: 1,
    title: '늦은 귀가, 끊긴 연락',
    icon: '📵',
    desc: '담쌓기와 걱정이 교차하는 상황',
    room: { key: 'wall', label: '벽', icon: '🧱', statKey: 'trust' },
    bg: 'bg_bedroom.png',
    situation: n => `${n.B}가 늦게 들어온다고 했는데 연락이 없어요. 1시간이 지나도 소식이 없자 ${n.A}가 먼저 문자를 보냈어요.`,
    A1: [
      { type: 'empathy',   slot: 'a', text: '괜찮아? 좀 걱정됐어.' },
      { type: 'avoidance', slot: 'b', text: '지금 어디야?' },
      { type: 'criticism', slot: 'c', text: '많이 늦네.' },
      { type: 'criticism', slot: 'd', text: '연락도 없이 이게 뭐야.' },
    ],
    B1: {
      a: [
        { type: 'empathy',   slot: 'a', text: '미안, 회식이 길어졌어. 걱정시켰지?' },
        { type: 'empathy',   slot: 'b', text: '아, 미안. 곧 들어가.' },
        { type: 'empathy',   slot: 'c', text: '연락 못 했어. 조금만 기다려줘.' },
        { type: 'criticism', slot: 'd', text: '연락할 틈이 없었어.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '회식 중이야. 미안, 연락 못 했지?' },
        { type: 'avoidance', slot: 'b', text: '거의 끝나가.' },
        { type: 'avoidance', slot: 'c', text: '왜, 무슨 일이야?' },
        { type: 'criticism', slot: 'd', text: '왜? 무슨 일이야. (짜증)' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '맞아, 미안해. 조금만 더 기다려줘.' },
        { type: 'avoidance', slot: 'b', text: '응, 좀 더 걸릴 것 같아.' },
        { type: 'avoidance', slot: 'c', text: '회식이 길어졌어.' },
        { type: 'criticism', slot: 'd', text: '원래 이런 거 알잖아.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '미안해. 연락했어야 했는데.' },
        { type: 'avoidance', slot: 'b', text: '회식 중이었어.' },
        { type: 'avoidance', slot: 'c', text: '바빴어.' },
        { type: 'criticism', slot: 'd', text: '맨날 감시야.' },
      ],
    },
    A2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '아니야, 다치진 않았나 해서. 밥은 먹었어?' },
        { type: 'empathy',   slot: 'b', text: '응, 기다릴게.' },
        { type: 'criticism', slot: 'c', text: '다음엔 짧게라도 연락 줘.' },
        { type: 'criticism', slot: 'd', text: '걱정시키면 안 되잖아.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '응, 기다릴게. 천천히 와.' },
        { type: 'avoidance', slot: 'b', text: '알겠어.' },
        { type: 'empathy',   slot: 'c', text: '밥은 먹었어?' },
        { type: 'criticism', slot: 'd', text: '곧이 몇 시간이야.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '그냥 좀 걱정돼서 그랬어.' },
        { type: 'avoidance', slot: 'b', text: '알겠어, 기다릴게.' },
        { type: 'empathy',   slot: 'c', text: '언제쯤 올 것 같아?' },
        { type: 'criticism', slot: 'd', text: '그럼 미리 말하지.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '감시가 아니라 걱정된 거야.' },
        { type: 'avoidance', slot: 'b', text: '…그래, 알겠어.' },
        { type: 'criticism', slot: 'c', text: '연락 한 번만 해줬으면 됐어.' },
        { type: 'criticism', slot: 'd', text: '감시 맞아. 연락도 없이 이게 뭐야.' },
      ],
    },
    B2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '응, 먹었어. 미안, 다음엔 꼭 연락할게.' },
        { type: 'avoidance', slot: 'b', text: '응, 금방 들어가.' },
        { type: 'empathy',   slot: 'c', text: '고마워.' },
        { type: 'avoidance', slot: 'd', text: '걱정 안 해도 돼.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '응, 조심히 갈게. 기다려줘서 고마워.' },
        { type: 'avoidance', slot: 'b', text: '어, 알겠어.' },
        { type: 'empathy',   slot: 'c', text: '미안.' },
        { type: 'avoidance', slot: 'd', text: '알아서 해.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '응, 먹었어. 미안, 다음엔 꼭 연락할게.' },
        { type: 'avoidance', slot: 'b', text: '거의 다 왔어.' },
        { type: 'empathy',   slot: 'c', text: '미안.' },
        { type: 'avoidance', slot: 'd', text: '알아서 해.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '맞아, 미안해. 다음엔 미리 말할게.' },
        { type: 'avoidance', slot: 'b', text: '…그럴게.' },
        { type: 'empathy',   slot: 'c', text: '바빴어, 미안.' },
        { type: 'criticism', slot: 'd', text: '맨날 뭐라 해.' },
      ],
    },
    A3: {
      a: [
        { type: 'empathy',   slot: 'a', text: '응, 조심히 와. 들어오면 얘기하자.' },
        { type: 'avoidance', slot: 'b', text: '알겠어.' },
        { type: 'empathy',   slot: 'c', text: '기다릴게.' },
        { type: 'criticism', slot: 'd', text: '다음엔 꼭 연락해.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '응, 천천히 와.' },
        { type: 'avoidance', slot: 'b', text: '어.' },
        { type: 'empathy',   slot: 'c', text: '조심히 와.' },
        { type: 'criticism', slot: 'd', text: '그게 다야?' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '응, 천천히 와.' },
        { type: 'avoidance', slot: 'b', text: '어.' },
        { type: 'empathy',   slot: 'c', text: '조심히 와.' },
        { type: 'criticism', slot: 'd', text: '그게 다야?' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '뭐라 하는 게 아니라 걱정된 거야.' },
        { type: 'avoidance', slot: 'b', text: '…알겠어.' },
        { type: 'avoidance', slot: 'c', text: '됐어, 조심히 와.' },
        { type: 'criticism', slot: 'd', text: '그래, 앞으로 신경 안 쓸게.' },
      ],
    },
    B3: {
      a: [
        { type: 'empathy',   text: '응, 들어가서 얘기하자. 기다려줘서 고마워.' },
        { type: 'avoidance', text: '어, 알겠어.' },
        { type: 'empathy',   text: '미안해.' },
        { type: 'avoidance', text: '됐어.' },
      ],
      b: [
        { type: 'empathy',   text: '응, 고마워.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '미안.' },
        { type: 'avoidance', text: '알아서 올게.' },
      ],
      c: [
        { type: 'empathy',   text: '응, 고마워.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '미안.' },
        { type: 'avoidance', text: '알아서 올게.' },
      ],
      d: [
        { type: 'empathy',   text: '걱정해줘서 고마워. 다음엔 꼭 연락할게.' },
        { type: 'empathy',   text: '…미안.' },
        { type: 'avoidance', text: '그럴게.' },
        { type: 'avoidance', text: '알겠다고.' },
      ],
    },
  },


  {
    id: 'drinks',
    difficulty: 2,
    title: '친구와의 술자리',
    icon: '🍻',
    desc: '상대의 사회적 관계와 자유를 인정할지 고민되는 상황',
    room: { key: 'bathroom', label: '욕실', icon: '🛁', statKey: 'boundary' },
    bg: 'bg_bathroom.png',
    situation: n => `${n.B}가 친구들이랑 저녁을 먹으러 간다고 말했어요. ${n.A}는 오늘 같이 있고 싶었어요.`,
    A1: [
      { type: 'empathy',   slot: 'a', text: '나 오늘 같이 있고 싶었는데. 꼭 가야 해?' },
      { type: 'avoidance', slot: 'b', text: '오늘 친구 만나는 거야?' },
      { type: 'empathy',   slot: 'c', text: '나도 데려가면 안 돼?' },
      { type: 'criticism', slot: 'd', text: '또 나 두고 가는 거야?' },
    ],
    B1: {
      a: [
        { type: 'empathy',   slot: 'a', text: '그랬구나. 오래된 친구라. 다녀와서 같이 있자.' },
        { type: 'empathy',   slot: 'b', text: '오래된 친구라서. 미안.' },
        { type: 'avoidance', slot: 'c', text: '꼭 가야 해서.' },
        { type: 'criticism', slot: 'd', text: '꼭 같이 있어야 해?' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '응, 오랜만에. 너 괜찮아?' },
        { type: 'avoidance', slot: 'b', text: '응, 왜?' },
        { type: 'avoidance', slot: 'c', text: '응.' },
        { type: 'criticism', slot: 'd', text: '왜? 뭔가 할 말 있어?' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '오늘은 좀 오래된 친구들이라. 다음엔 같이 가자.' },
        { type: 'avoidance', slot: 'b', text: '그건 좀… 오늘은 어렵겠다.' },
        { type: 'avoidance', slot: 'c', text: '오늘은 좀 힘들 것 같아.' },
        { type: 'criticism', slot: 'd', text: '친구 만나는 데 왜 같이 가.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '나 두고 가는 게 아니야. 친구도 만나야 하잖아.' },
        { type: 'criticism', slot: 'b', text: '맨날은 아니잖아.' },
        { type: 'empathy',   slot: 'c', text: '그렇게 말하면 서운하다.' },
        { type: 'criticism', slot: 'd', text: '허락 받아야 해?' },
      ],
    },
    A2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '그래, 재밌게 다녀와. 다녀와서 얘기 들려줘.' },
        { type: 'avoidance', slot: 'b', text: '응, 빨리 와.' },
        { type: 'empathy',   slot: 'c', text: '오늘 같이 있고 싶었어, 솔직히.' },
        { type: 'criticism', slot: 'd', text: '다녀와서 같이 있으면 뭐가 달라.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '아니야, 다녀와. 다음엔 같이 나가자.' },
        { type: 'avoidance', slot: 'b', text: '응.' },
        { type: 'empathy',   slot: 'c', text: '나도 같이 가고 싶었어.' },
        { type: 'criticism', slot: 'd', text: '맨날 미안만 하면 뭐가 달라.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '응, 그래. 다음엔 같이 가자.' },
        { type: 'avoidance', slot: 'b', text: '알겠어.' },
        { type: 'empathy',   slot: 'c', text: '다음엔 나도 같이 가고 싶어.' },
        { type: 'criticism', slot: 'd', text: '맨날 어렵다고 하면 언제 같이 가.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '허락이 아니라 같이 있고 싶다는 거야.' },
        { type: 'avoidance', slot: 'b', text: '…됐어, 다녀와.' },
        { type: 'criticism', slot: 'c', text: '왜 그렇게 말해.' },
        { type: 'criticism', slot: 'd', text: '그럼 나도 혼자 살게.' },
      ],
    },
    B2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '응, 재밌는 거 있으면 얘기해줄게. 금방 다녀올게.' },
        { type: 'avoidance', slot: 'b', text: '응, 다녀올게.' },
        { type: 'empathy',   slot: 'c', text: '고마워.' },
        { type: 'avoidance', slot: 'd', text: '어.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '그랬구나, 미안. 다음엔 같이 있자.' },
        { type: 'empathy',   slot: 'b', text: '미안.' },
        { type: 'empathy',   slot: 'c', text: '나도 같이 있고 싶은데.' },
        { type: 'criticism', slot: 'd', text: '친구도 만나야 하잖아.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '그랬구나, 미안. 다음엔 같이 있자.' },
        { type: 'empathy',   slot: 'b', text: '미안.' },
        { type: 'empathy',   slot: 'c', text: '나도 같이 있고 싶은데.' },
        { type: 'criticism', slot: 'd', text: '친구도 만나야 하잖아.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '혼자 살자는 말 하지 마. 나 그 말 싫어.' },
        { type: 'criticism', slot: 'b', text: '왜 그렇게 말해.' },
        { type: 'empathy',   slot: 'c', text: '그런 말 상처돼.' },
        { type: 'avoidance', slot: 'd', text: '그래, 알아서 해.' },
      ],
    },
    A3: {
      a: [
        { type: 'empathy',   slot: 'a', text: '응, 조심히 다녀와. 들어오면 얘기하자.' },
        { type: 'empathy',   slot: 'b', text: '응, 기다릴게.' },
        { type: 'avoidance', slot: 'c', text: '알겠어.' },
        { type: 'criticism', slot: 'd', text: '빨리 와.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '아니야, 다녀와. 다음엔 같이 나가자.' },
        { type: 'avoidance', slot: 'b', text: '응, 다녀와.' },
        { type: 'avoidance', slot: 'c', text: '알겠어.' },
        { type: 'criticism', slot: 'd', text: '맨날 미안이야.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '아니야, 다녀와. 다음엔 같이 나가자.' },
        { type: 'avoidance', slot: 'b', text: '응, 다녀와.' },
        { type: 'avoidance', slot: 'c', text: '알겠어.' },
        { type: 'criticism', slot: 'd', text: '맨날 미안이야.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '그런 말 한 건 미안해. 그냥 같이 있고 싶었어.' },
        { type: 'avoidance', slot: 'b', text: '…됐어.' },
        { type: 'empathy',   slot: 'c', text: '미안.' },
        { type: 'avoidance', slot: 'd', text: '됐어.' },
      ],
    },
    B3: {
      a: [
        { type: 'empathy',   text: '응, 들어와서 오늘 얘기 해줄게. 기다려줘서 고마워.' },
        { type: 'avoidance', text: '어, 알겠어.' },
        { type: 'empathy',   text: '미안해, 다음엔 같이 있자.' },
        { type: 'avoidance', text: '어.' },
      ],
      b: [
        { type: 'empathy',   text: '응, 다음엔 같이 나가자.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '미안.' },
        { type: 'avoidance', text: '알아서 해.' },
      ],
      c: [
        { type: 'empathy',   text: '응, 다음엔 같이 나가자.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '미안.' },
        { type: 'avoidance', text: '알아서 해.' },
      ],
      d: [
        { type: 'empathy',   text: '그 말 듣기 싫어. 같이 있고 싶어서 그런 거 알아.' },
        { type: 'empathy',   text: '…미안.' },
        { type: 'empathy',   text: '나도 미안해.' },
        { type: 'avoidance', text: '그래.' },
      ],
    },
  },

  {
    id: 'weekend_plans',
    difficulty: 1,
    title: '쉬는 날 계획 충돌',
    icon: '🛌',
    desc: '서로의 개인 공간을 존중하는 법을 배우는 상황',
    room: { key: 'bathroom', label: '욕실', icon: '🛁', statKey: 'boundary' },
    bg: 'bg_bathroom.png',
    situation: n => `주말에 ${n.B}는 집에서 쉬고 싶어 하고, ${n.A}는 오랜만에 밖에 나가고 싶어요.`,
    A1: [
      { type: 'empathy',   slot: 'a', text: '나 오늘 좀 나가고 싶은데, 너는 어때?' },
      { type: 'avoidance', slot: 'b', text: '오늘 뭐 할 거야?' },
      { type: 'empathy',   slot: 'c', text: '오늘 나가는 거 어때?' },
      { type: 'criticism', slot: 'd', text: '맨날 집에만 있으면 지겹지도 않아?' },
    ],
    B1: {
      a: [
        { type: 'empathy',   slot: 'a', text: '나는 좀 쉬고 싶어. 혼자 다녀와도 돼.' },
        { type: 'avoidance', slot: 'b', text: '어디 가려고?' },
        { type: 'avoidance', slot: 'c', text: '나는 좀 피곤한데…' },
        { type: 'criticism', slot: 'd', text: '꼭 같이 가야 해?' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '집에 있으려고. 너는 나가고 싶어?' },
        { type: 'avoidance', slot: 'b', text: '딱히 없어.' },
        { type: 'avoidance', slot: 'c', text: '왜?' },
        { type: 'criticism', slot: 'd', text: '왜? 또 어디 가려고.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '나는 쉬고 싶긴 한데, 네가 가고 싶으면 같이 갈게.' },
        { type: 'avoidance', slot: 'b', text: '오늘 좀 피곤한데…' },
        { type: 'avoidance', slot: 'c', text: '어디 가려고?' },
        { type: 'criticism', slot: 'd', text: '나 오늘 쉬고 싶어.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '집이 충전되는 공간이야. 나쁜 건 아니잖아.' },
        { type: 'empathy',   slot: 'b', text: '지겨운 거 아니야, 그냥 쉬고 싶어.' },
        { type: 'avoidance', slot: 'c', text: '그럼 나가.' },
        { type: 'criticism', slot: 'd', text: '그럼 혼자 나가.' },
      ],
    },
    A2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '아니야, 쉬어. 나 잠깐 나갔다 올게.' },
        { type: 'criticism', slot: 'b', text: '같이 가주면 좋긴 한데.' },
        { type: 'empathy',   slot: 'c', text: '그럼 나 다녀와서 같이 저녁 먹자.' },
        { type: 'criticism', slot: 'd', text: '맨날 혼자 가야 해?' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '그래, 쉬어. 나 혼자 다녀올게.' },
        { type: 'empathy',   slot: 'b', text: '조금만 나갔다 오면 어때?' },
        { type: 'empathy',   slot: 'c', text: '그럼 같이 근처만 나가자.' },
        { type: 'criticism', slot: 'd', text: '맨날 피곤하다고 하면 언제 나가.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '카페 갔다가 산책하려고. 같이 갈래?' },
        { type: 'avoidance', slot: 'b', text: '그냥 근처.' },
        { type: 'empathy',   slot: 'c', text: '너 가고 싶은 데 있어?' },
        { type: 'criticism', slot: 'd', text: '왜, 허락 받아야 해?' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '같이 가자는 거였는데, 혼자 다녀올게.' },
        { type: 'avoidance', slot: 'b', text: '…알겠어.' },
        { type: 'criticism', slot: 'c', text: '왜 그렇게 말해.' },
        { type: 'criticism', slot: 'd', text: '맨날 이런 식이야.' },
      ],
    },
    B2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '응, 다녀와. 다녀와서 같이 저녁 먹자.' },
        { type: 'avoidance', slot: 'b', text: '응, 다녀와.' },
        { type: 'empathy',   slot: 'c', text: '미안, 나도 같이 갈걸.' },
        { type: 'avoidance', slot: 'd', text: '어.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '그럴까? 잠깐만 나가는 거면 괜찮아.' },
        { type: 'avoidance', slot: 'b', text: '…그래.' },
        { type: 'avoidance', slot: 'c', text: '가까운 데만?' },
        { type: 'criticism', slot: 'd', text: '억지로 가기 싫어.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '좋아, 그러자.' },
        { type: 'avoidance', slot: 'b', text: '음… 그래.' },
        { type: 'empathy',   slot: 'c', text: '카페나 공원 정도?' },
        { type: 'empathy',   slot: 'd', text: '미안, 그렇게 말할 의도는 아니었어.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '허락이 아니라 같이 가고 싶어서 물어본 거야.' },
        { type: 'avoidance', slot: 'b', text: '그냥 물어본 건데.' },
        { type: 'empathy',   slot: 'c', text: '같이 가고 싶었어.' },
        { type: 'criticism', slot: 'd', text: '그럼 혼자 가.' },
      ],
    },
    A3: {
      a: [
        { type: 'empathy',   slot: 'a', text: '응, 금방 다녀올게. 저녁 뭐 먹을지 생각해놔.' },
        { type: 'avoidance', slot: 'b', text: '응, 알겠어.' },
        { type: 'empathy',   slot: 'c', text: '같이 가자 그냥.' },
        { type: 'criticism', slot: 'd', text: '맨날 혼자.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '억지로 말고, 다음엔 같이 가자.' },
        { type: 'avoidance', slot: 'b', text: '그래, 다녀올게.' },
        { type: 'avoidance', slot: 'c', text: '알겠어.' },
        { type: 'criticism', slot: 'd', text: '그럼 앞으로 혼자 다닐게.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '억지로 말고, 다음엔 같이 가자.' },
        { type: 'avoidance', slot: 'b', text: '그래, 다녀올게.' },
        { type: 'avoidance', slot: 'c', text: '알겠어.' },
        { type: 'criticism', slot: 'd', text: '그럼 앞으로 혼자 다닐게.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '알겠어. 혼자 다녀올게.' },
        { type: 'avoidance', slot: 'b', text: '…그래.' },
        { type: 'empathy',   slot: 'c', text: '다음엔 같이 가자.' },
        { type: 'criticism', slot: 'd', text: '맨날 이래.' },
      ],
    },
    B3: {
      a: [
        { type: 'empathy',   text: '응, 재밌게 다녀와. 저녁 같이 먹자.' },
        { type: 'avoidance', text: '어, 다녀와.' },
        { type: 'empathy',   text: '미안, 나도 나갈걸.' },
        { type: 'avoidance', text: '어.' },
      ],
      b: [
        { type: 'empathy',   text: '응, 다음엔 같이 가자.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '미안.' },
        { type: 'avoidance', text: '알아서 해.' },
      ],
      c: [
        { type: 'empathy',   text: '응, 다음엔 같이 가자.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '미안.' },
        { type: 'avoidance', text: '알아서 해.' },
      ],
      d: [
        { type: 'empathy',   text: '그러지 마. 같이 가자고.' },
        { type: 'empathy',   text: '…미안.' },
        { type: 'empathy',   text: '나도 나갈게.' },
        { type: 'avoidance', text: '그래.' },
      ],
    },
  },


  {
    id: 'tired_evening',
    difficulty: 2,
    title: '피곤함과 서운함의 충돌',
    icon: '📱',
    desc: '서로의 피곤함이 대화의 문을 막는 상황',
    room: { key: 'living', label: '거실', icon: '🛋️', statKey: 'communication' },
    bg: 'bg_living.png',
    situation: n => `퇴근 후 ${n.B}가 소파에 누워서 핸드폰만 보고 있어요. ${n.A}도 오늘 힘들었지만, 같이 대화하고 싶어요.`,
    A1: [
      { type: 'empathy',   slot: 'a', text: '오늘 많이 힘들었어? 나도 좀 힘들었는데 같이 얘기할 수 있어?' },
      { type: 'empathy',   slot: 'b', text: '요즘 피곤해 보이더라.' },
      { type: 'avoidance', slot: 'c', text: '나 오늘 진짜 힘든 일 있었는데…' },
      { type: 'criticism', slot: 'd', text: '맨날 핸드폰만 봐. 나는 안 보여?' },
    ],
    B1: {
      a: [
        { type: 'empathy',   slot: 'a', text: '미안, 나 좀 방전됐어. 10분만 있다가 얘기하자.' },
        { type: 'empathy',   slot: 'b', text: '응? 무슨 일 있었어?' },
        { type: 'criticism', slot: 'c', text: '나도 힘들었어.' },
        { type: 'criticism', slot: 'd', text: '나도 힘들어. 왜 나만 챙겨야 해.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '응, 요즘 좀 그래. 너는 괜찮아?' },
        { type: 'avoidance', slot: 'b', text: '좀 그래.' },
        { type: 'avoidance', slot: 'c', text: '왜? 뭔가 할 말 있어?' },
        { type: 'avoidance', slot: 'd', text: '그냥 피곤해.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '어, 무슨 일이야? 말해봐.' },
        { type: 'criticism', slot: 'b', text: '나도 힘들었어. (자기 얘기로)' },
        { type: 'avoidance', slot: 'c', text: '응?' },
        { type: 'avoidance', slot: 'd', text: '(반응 없이 핸드폰 계속)' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '미안, 너 얘기 들을게. 오늘 어땠어?' },
        { type: 'avoidance', slot: 'b', text: '나 잠깐 쉬고 싶었던 건데…' },
        { type: 'criticism', slot: 'c', text: '핸드폰 보면 안 돼?' },
        { type: 'criticism', slot: 'd', text: '내가 언제 너 안 챙겼어.' },
      ],
    },
    A2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '아니야, 쉬어. 나도 그냥 같이 있고 싶었어.' },
        { type: 'empathy',   slot: 'b', text: '응, 10분 후에 얘기하자.' },
        { type: 'empathy',   slot: 'c', text: '요즘 많이 힘들어?' },
        { type: 'criticism', slot: 'd', text: '맨날 방전이야.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '그랬구나. 너도 힘들었어? 같이 얘기하자.' },
        { type: 'avoidance', slot: 'b', text: '그래?' },
        { type: 'criticism', slot: 'c', text: '나도 힘들었는데.' },
        { type: 'criticism', slot: 'd', text: '내 얘기 듣기 싫어?' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '나 지금 얘기하고 싶은데, 잠깐만 봐줄 수 있어?' },
        { type: 'avoidance', slot: 'b', text: '…됐어.' },
        { type: 'empathy',   slot: 'c', text: '나 얘기해도 돼?' },
        { type: 'criticism', slot: 'd', text: '진짜 나 투명인간이야?' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '챙겨달라는 게 아니라 같이 있고 싶다는 거야.' },
        { type: 'avoidance', slot: 'b', text: '…그래.' },
        { type: 'empathy',   slot: 'c', text: '너도 힘들었어?' },
        { type: 'criticism', slot: 'd', text: '맨날 피곤하다고만 하잖아.' },
      ],
    },
    B2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '고마워. 나 오늘 진짜 방전됐는데 그 말 들으니까 좀 낫다.' },
        { type: 'avoidance', slot: 'b', text: '응, 잠깐만.' },
        { type: 'empathy',   slot: 'c', text: '미안.' },
        { type: 'avoidance', slot: 'd', text: '됐어, 그냥 쉬자.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '그래, 오늘 뭔 일 있었어?' },
        { type: 'empathy',   slot: 'b', text: '응, 얘기해봐.' },
        { type: 'criticism', slot: 'c', text: '나도 좀 힘들었어.' },
        { type: 'avoidance', slot: 'd', text: '지금 얘기해야 해?' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '응, 말해. 내가 들을게.' },
        { type: 'avoidance', slot: 'b', text: '어… 응.' },
        { type: 'avoidance', slot: 'c', text: '잠깐만.' },
        { type: 'criticism', slot: 'd', text: '지금 좀 힘들어.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '맞아, 나도 표현을 못 했네. 오늘 어땠어?' },
        { type: 'criticism', slot: 'b', text: '피곤한 게 잘못이야?' },
        { type: 'empathy',   slot: 'c', text: '미안.' },
        { type: 'criticism', slot: 'd', text: '맨날 뭐라 해.' },
      ],
    },
    A3: {
      a: [
        { type: 'empathy',   slot: 'a', text: '나도 네가 힘들 땐 그냥 옆에 있어줄게.' },
        { type: 'empathy',   slot: 'b', text: '응, 고마워.' },
        { type: 'empathy',   slot: 'c', text: '오늘 무슨 일 있었어?' },
        { type: 'criticism', slot: 'd', text: '맨날 내가 먼저 말해야 해.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '들어줘서 고마워.' },
        { type: 'avoidance', slot: 'b', text: '응.' },
        { type: 'empathy',   slot: 'c', text: '나도 네 얘기 듣고 싶어.' },
        { type: 'criticism', slot: 'd', text: '관심 없는 거 알아.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '들어줘서 고마워.' },
        { type: 'avoidance', slot: 'b', text: '응.' },
        { type: 'empathy',   slot: 'c', text: '나도 네 얘기 듣고 싶어.' },
        { type: 'criticism', slot: 'd', text: '관심 없는 거 알아.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '지금 힘들면 나중에 얘기하자. 기다릴게.' },
        { type: 'avoidance', slot: 'b', text: '…알겠어.' },
        { type: 'avoidance', slot: 'c', text: '그래.' },
        { type: 'avoidance', slot: 'd', text: '됐어.' },
      ],
    },
    B3: {
      a: [
        { type: 'empathy',   text: '응, 나도 네가 힘들 땐 옆에 있을게.' },
        { type: 'empathy',   text: '어, 고마워.' },
        { type: 'empathy',   text: '미안, 오늘 내가 너무 지쳐 있었어.' },
        { type: 'avoidance', text: '어.' },
      ],
      b: [
        { type: 'empathy',   text: '응, 나도 네 얘기 들을게.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '미안.' },
        { type: 'avoidance', text: '됐어.' },
      ],
      c: [
        { type: 'empathy',   text: '응, 나도 네 얘기 들을게.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '미안.' },
        { type: 'avoidance', text: '됐어.' },
      ],
      d: [
        { type: 'empathy',   text: '관심 없는 거 아니야. 오늘 진짜 힘들었어.' },
        { type: 'empathy',   text: '…미안.' },
        { type: 'empathy',   text: '나도 미안해.' },
        { type: 'avoidance', text: '그래.' },
      ],
    },
  },

  {
    id: 'chores_split',
    difficulty: 2,
    title: '집안일 분담 인식 차이',
    icon: '🧹',
    desc: '당연하게 여겨진 노력에 대한 인정의 문제',
    room: { key: 'kitchen', label: '주방', icon: '🍳', statKey: 'cooperation' },
    bg: 'bg_kitchen.png',
    situation: n => `오늘 ${n.A}가 청소를 혼자 다 했어요. ${n.B}는 고마움을 표현하지 않고 지나갔어요.`,
    A1: [
      { type: 'empathy',   slot: 'a', text: '오늘 내가 청소 다 했는데, 좀 힘들었어.' },
      { type: 'avoidance', slot: 'b', text: '집 깨끗해졌지?' },
      { type: 'empathy',   slot: 'c', text: '청소 좀 같이 했으면 좋겠어.' },
      { type: 'criticism', slot: 'd', text: '내가 이 집 가정부야?' },
    ],
    B1: {
      a: [
        { type: 'empathy',   slot: 'a', text: '어, 고마워. 내가 요즘 너무 신경 못 썼네.' },
        { type: 'avoidance', slot: 'b', text: '응, 깨끗하네. (무심코)' },
        { type: 'empathy',   slot: 'c', text: '수고했어.' },
        { type: 'criticism', slot: 'd', text: '나도 할 일이 있었는데.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '응, 수고했어.' },
        { type: 'avoidance', slot: 'b', text: '어? 어.' },
        { type: 'avoidance', slot: 'c', text: '깨끗하다.' },
        { type: 'criticism', slot: 'd', text: '원래 이 정도는 해야지.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '맞아, 내가 더 신경 쓸게. 어떻게 나눌까?' },
        { type: 'criticism', slot: 'b', text: '나는 다른 걸 하잖아.' },
        { type: 'empathy',   slot: 'c', text: '다음엔 같이 하자.' },
        { type: 'criticism', slot: 'd', text: '그럼 하지 마.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '미안해. 당연하게 생각했어.' },
        { type: 'criticism', slot: 'b', text: '왜 그렇게까지 말해.' },
        { type: 'criticism', slot: 'c', text: '내가 뭘 그렇게 잘못했어.' },
        { type: 'avoidance', slot: 'd', text: '그럼 강요 안 해.' },
      ],
    },
    A2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '고마워. 같이 정하면 더 편할 것 같아.' },
        { type: 'avoidance', slot: 'b', text: '아니야, 괜찮아.' },
        { type: 'empathy',   slot: 'c', text: '다음엔 같이 하자.' },
        { type: 'criticism', slot: 'd', text: '맨날 신경 못 쓰면 어떡해.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '그냥 알아줬으면 했어.' },
        { type: 'avoidance', slot: 'b', text: '…됐어.' },
        { type: 'empathy',   slot: 'c', text: '수고했다는 말이 듣고 싶었어.' },
        { type: 'criticism', slot: 'd', text: '그게 다야?' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '맞아. 그러니까 같이 나눠서 하자는 거야.' },
        { type: 'criticism', slot: 'b', text: '그래도 집안일은 같이 해야 하지 않아?' },
        { type: 'empathy',   slot: 'c', text: '어떻게 나눌지 얘기해보자.' },
        { type: 'criticism', slot: 'd', text: '그게 변명이야?' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '강요가 아니라 같이 하고 싶다는 거야.' },
        { type: 'avoidance', slot: 'b', text: '…알겠어.' },
        { type: 'criticism', slot: 'c', text: '그런 말이 상처돼.' },
        { type: 'avoidance', slot: 'd', text: '그래, 앞으로 나 혼자 할게.' },
      ],
    },
    B2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '미안, 그냥 지나쳤네. 수고했어, 진심으로.' },
        { type: 'empathy',   slot: 'b', text: '…수고했어.' },
        { type: 'empathy',   slot: 'c', text: '몰랐어, 미안.' },
        { type: 'criticism', slot: 'd', text: '그런 게 필요해?' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '맞아, 같이 정하자. 나 뭐 하면 좋을까?' },
        { type: 'avoidance', slot: 'b', text: '응, 그러자.' },
        { type: 'empathy',   slot: 'c', text: '미안, 내가 더 신경 쓸게.' },
        { type: 'avoidance', slot: 'd', text: '꼭 정해야 해?' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '그러자. 뭐부터 정할까?' },
        { type: 'avoidance', slot: 'b', text: '생각해볼게.' },
        { type: 'empathy',   slot: 'c', text: '나 뭐 하면 돼?' },
        { type: 'avoidance', slot: 'd', text: '굳이 정해야 해?' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '그러지 마. 같이 하자.' },
        { type: 'empathy',   slot: 'b', text: '…미안.' },
        { type: 'empathy',   slot: 'c', text: '내가 더 신경 쓸게.' },
        { type: 'avoidance', slot: 'd', text: '그래, 알아서 해.' },
      ],
    },
    A3: {
      a: [
        { type: 'empathy',   slot: 'a', text: '설거지는 네가, 청소는 내가 하면 어때?' },
        { type: 'empathy',   slot: 'b', text: '응, 고마워.' },
        { type: 'empathy',   slot: 'c', text: '그냥 같이 하면 돼.' },
        { type: 'criticism', slot: 'd', text: '매번 내가 말해야 해?' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '고마워. 그 말 듣고 싶었어.' },
        { type: 'avoidance', slot: 'b', text: '응.' },
        { type: 'empathy',   slot: 'c', text: '다음엔 미리 말할게.' },
        { type: 'criticism', slot: 'd', text: '말해줘야 알아?' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '고마워. 그 말 듣고 싶었어.' },
        { type: 'avoidance', slot: 'b', text: '응.' },
        { type: 'empathy',   slot: 'c', text: '다음엔 미리 말할게.' },
        { type: 'criticism', slot: 'd', text: '말해줘야 알아?' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '필요한 게 아니라 인정받고 싶었어.' },
        { type: 'avoidance', slot: 'b', text: '…됐어.' },
        { type: 'avoidance', slot: 'c', text: '그냥 넘기자.' },
        { type: 'criticism', slot: 'd', text: '앞으로 기대 안 할게.' },
      ],
    },
    B3: {
      a: [
        { type: 'empathy',   text: '응, 그렇게 하자. 나 더 신경 쓸게.' },
        { type: 'empathy',   text: '어, 그러자.' },
        { type: 'empathy',   text: '미안했어.' },
        { type: 'avoidance', text: '어.' },
      ],
      b: [
        { type: 'empathy',   text: '응, 앞으로 더 잘할게.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '미안.' },
        { type: 'avoidance', text: '알겠어.' },
      ],
      c: [
        { type: 'empathy',   text: '응, 앞으로 더 잘할게.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '미안.' },
        { type: 'avoidance', text: '알겠어.' },
      ],
      d: [
        { type: 'empathy',   text: '그런 말 하지 마. 같이 하고 싶어.' },
        { type: 'empathy',   text: '…미안.' },
        { type: 'empathy',   text: '나도 미안해.' },
        { type: 'avoidance', text: '그래.' },
      ],
    },
  },


  {
    id: 'quiet_partner',
    difficulty: 2,
    title: '감정 표현 방식의 차이',
    icon: '🌙',
    desc: '말없음 뒤에 숨은 마음을 기다려주는 상황',
    room: { key: 'bedroom', label: '침실', icon: '🛏️', statKey: 'intimacy' },
    bg: 'bg_bedroom.png',
    situation: n => `요즘 ${n.B}가 말이 없고 무뚝뚝해요. 뭔가 불만이 있는 것 같은데 직접 말을 안 해요.`,
    A1: [
      { type: 'empathy',   slot: 'a', text: '요즘 좀 조용한 것 같아서. 나한테 서운한 게 있어?' },
      { type: 'empathy',   slot: 'b', text: '요즘 무슨 일 있어?' },
      { type: 'avoidance', slot: 'c', text: '(아무 말 없이 기다린다)' },
      { type: 'criticism', slot: 'd', text: '왜 그렇게 말 없어. 뭐가 불만이야.' },
    ],
    B1: {
      a: [
        { type: 'empathy',   slot: 'a', text: '응, 사실 좀 서운했어. 말하기가 어려웠어.' },
        { type: 'avoidance', slot: 'b', text: '아니, 그냥 피곤해서.' },
        { type: 'avoidance', slot: 'c', text: '별거 아니야.' },
        { type: 'avoidance', slot: 'd', text: '서운한 거 없어.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '사실 좀 있어. 얘기해도 돼?' },
        { type: 'avoidance', slot: 'b', text: '별거 아니야.' },
        { type: 'avoidance', slot: 'c', text: '왜?' },
        { type: 'criticism', slot: 'd', text: '왜? 내가 이상해 보여?' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '…사실 좀 속상했어.' },
        { type: 'avoidance', slot: 'b', text: '… (침묵 유지)' },
        { type: 'avoidance', slot: 'c', text: '왜 그래.' },
        { type: 'criticism', slot: 'd', text: '뭘 그렇게 쳐다봐.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '말 안 한 건 어떻게 말해야 할지 몰라서였어.' },
        { type: 'avoidance', slot: 'b', text: '불만 아니야.' },
        { type: 'criticism', slot: 'c', text: '그렇게 물으면 더 말하기 싫어.' },
        { type: 'criticism', slot: 'd', text: '따지지 마.' },
      ],
    },
    A2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '말해줘서 고마워. 내가 뭘 했는지 알고 싶어.' },
        { type: 'empathy',   slot: 'b', text: '그랬구나, 미안해.' },
        { type: 'empathy',   slot: 'c', text: '언제든 말해줘.' },
        { type: 'criticism', slot: 'd', text: '왜 진작 말 안 했어.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '별거 아니어도 괜찮아. 그냥 듣고 싶어.' },
        { type: 'avoidance', slot: 'b', text: '그래? 알겠어.' },
        { type: 'empathy',   slot: 'c', text: '그래도 말해줘.' },
        { type: 'criticism', slot: 'd', text: '별거 아니면 말을 하든가.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '말하기 어려우면 기다릴게.' },
        { type: 'avoidance', slot: 'b', text: '…그래.' },
        { type: 'criticism', slot: 'c', text: '왜 말 안 해.' },
        { type: 'criticism', slot: 'd', text: '계속 이럴 거야?' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '따지는 게 아니야. 그냥 네가 어떤지 알고 싶어.' },
        { type: 'avoidance', slot: 'b', text: '…알겠어.' },
        { type: 'criticism', slot: 'c', text: '그럼 어떻게 물어봐.' },
        { type: 'criticism', slot: 'd', text: '그럼 계속 혼자 있어.' },
      ],
    },
    B2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '사실 요즘 네가 바빠 보여서 말 걸기가 어려웠어.' },
        { type: 'avoidance', slot: 'b', text: '…그냥 좀 예민했어.' },
        { type: 'avoidance', slot: 'c', text: '별거 아닌데.' },
        { type: 'avoidance', slot: 'd', text: '됐어.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '고마워. 사실 좀 서운했어.' },
        { type: 'avoidance', slot: 'b', text: '응.' },
        { type: 'avoidance', slot: 'c', text: '괜찮아.' },
        { type: 'avoidance', slot: 'd', text: '그냥 넘어가자.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '고마워. 사실 좀 서운했어.' },
        { type: 'avoidance', slot: 'b', text: '응.' },
        { type: 'avoidance', slot: 'c', text: '괜찮아.' },
        { type: 'avoidance', slot: 'd', text: '그냥 넘어가자.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '그렇게 말하니까 더 말하기 싫어지잖아.' },
        { type: 'empathy',   slot: 'b', text: '…미안.' },
        { type: 'avoidance', slot: 'c', text: '나도 어떻게 말해야 할지 모르겠어.' },
        { type: 'avoidance', slot: 'd', text: '됐어.' },
      ],
    },
    A3: {
      a: [
        { type: 'empathy',   slot: 'a', text: '그랬구나. 바빠 보여도 언제든 말해줘.' },
        { type: 'empathy',   slot: 'b', text: '미안, 내가 너무 바빴나봐.' },
        { type: 'empathy',   slot: 'c', text: '앞으로는 말해줘.' },
        { type: 'criticism', slot: 'd', text: '왜 말 못 해.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '그랬구나. 나 항상 들을게.' },
        { type: 'avoidance', slot: 'b', text: '응.' },
        { type: 'avoidance', slot: 'c', text: '알겠어.' },
        { type: 'criticism', slot: 'd', text: '말해야 알지.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '그랬구나. 나 항상 들을게.' },
        { type: 'avoidance', slot: 'b', text: '응.' },
        { type: 'avoidance', slot: 'c', text: '알겠어.' },
        { type: 'criticism', slot: 'd', text: '말해야 알지.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '지금 말하기 어려우면 나중에 얘기하자.' },
        { type: 'avoidance', slot: 'b', text: '…알겠어.' },
        { type: 'avoidance', slot: 'c', text: '그래.' },
        { type: 'avoidance', slot: 'd', text: '됐어, 그냥 넘기자.' },
      ],
    },
    B3: {
      a: [
        { type: 'empathy',   text: '응, 다음엔 말할게. 들어줘서 고마워.' },
        { type: 'empathy',   text: '어, 고마워.' },
        { type: 'empathy',   text: '미안.' },
        { type: 'avoidance', text: '어.' },
      ],
      b: [
        { type: 'empathy',   text: '응, 다음엔 말할게.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '미안해.' },
        { type: 'avoidance', text: '알겠어.' },
      ],
      c: [
        { type: 'empathy',   text: '응, 다음엔 말할게.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '미안해.' },
        { type: 'avoidance', text: '알겠어.' },
      ],
      d: [
        { type: 'empathy',   text: '나도 더 잘 표현할게.' },
        { type: 'avoidance', text: '…그래.' },
        { type: 'empathy',   text: '나도 미안해.' },
        { type: 'avoidance', text: '그래.' },
      ],
    },
  },


  {
    id: 'forgotten_day',
    difficulty: 3,
    title: '반복된 실망 경험',
    icon: '🎤',
    desc: '중요한 날을 잊은 무심함이 누적된 상황',
    room: { key: 'living', label: '거실', icon: '🛋️', statKey: 'communication' },
    bg: 'bg_living.png',
    situation: n => `오늘은 중요한 발표가 있는 날이었는데, ${n.B}가 "잘됐어?"라는 말 한마디 없이 지나갔어요. 이런 일이 처음이 아니에요.`,
    A1: [
      { type: 'empathy',   slot: 'a', text: '오늘 발표 있었는데 기억하고 있었어?' },
      { type: 'avoidance', slot: 'b', text: '오늘 좀 힘든 날이었어.' },
      { type: 'avoidance', slot: 'c', text: '(아무 말 안 한다)' },
      { type: 'criticism', slot: 'd', text: '역시 넌 내 일에 관심 없구나.' },
    ],
    B1: {
      a: [
        { type: 'empathy',   slot: 'a', text: '아, 맞다. 어떻게 됐어? 미안, 물어봤어야 했는데.' },
        { type: 'avoidance', slot: 'b', text: '발표 있었어? 어떻게 됐어? (뒤늦게)' },
        { type: 'empathy',   slot: 'c', text: '미안, 깜빡했어.' },
        { type: 'criticism', slot: 'd', text: '내가 다 기억할 수는 없잖아.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '많이 힘들어 보여. 무슨 일 있었어?' },
        { type: 'criticism', slot: 'b', text: '나도 힘들었어.' },
        { type: 'avoidance', slot: 'c', text: '왜?' },
        { type: 'criticism', slot: 'd', text: '왜? 무슨 일이야. (귀찮은 듯)' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '오늘 좀 안 좋아 보여. 괜찮아?' },
        { type: 'avoidance', slot: 'b', text: '(눈치 못 채고 각자 핸드폰)' },
        { type: 'avoidance', slot: 'c', text: '왜 그래.' },
        { type: 'criticism', slot: 'd', text: '왜 그래. (짧게)' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '맞아, 내가 더 신경 썼어야 했어. 나한테 화난 거야?' },
        { type: 'avoidance', slot: 'b', text: '그런 거 아니야… 바빴어.' },
        { type: 'criticism', slot: 'c', text: '그런 말은 좀.' },
        { type: 'criticism', slot: 'd', text: '내가 항상 그렇다고 생각하지 마.' },
      ],
    },
    A2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '고마워. 사실 기다렸어. 이번 한 번만이 아니라서.' },
        { type: 'avoidance', slot: 'b', text: '잘 끝났어.' },
        { type: 'criticism', slot: 'c', text: '다음엔 기억해줘.' },
        { type: 'criticism', slot: 'd', text: '맨날 뒤늦게야.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '그랬구나. 너도 힘들었어? 같이 얘기하자.' },
        { type: 'avoidance', slot: 'b', text: '…그래.' },
        { type: 'criticism', slot: 'c', text: '나도 힘들었는데.' },
        { type: 'criticism', slot: 'd', text: '내 얘기 들을 생각은 없어?' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '나 오늘 힘든 날이었어. 얘기해도 돼?' },
        { type: 'avoidance', slot: 'b', text: '…됐어.' },
        { type: 'criticism', slot: 'c', text: '발표 있었는데.' },
        { type: 'criticism', slot: 'd', text: '진짜 관심 없구나.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '항상이 아니라 오늘 하나만 얘기하는 거야.' },
        { type: 'avoidance', slot: 'b', text: '…알겠어.' },
        { type: 'empathy',   slot: 'c', text: '항상은 아니지만 오늘은 서운했어.' },
        { type: 'criticism', slot: 'd', text: '그게 변명이야?' },
      ],
    },
    B2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '그랬구나. 오래됐어? 나한테 말 못 한 게 많아?' },
        { type: 'empathy',   slot: 'b', text: '미안, 몰랐어.' },
        { type: 'empathy',   slot: 'c', text: '그래? 뭔데.' },
        { type: 'criticism', slot: 'd', text: '맨날 서운하다고 하면 나도 힘들어.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '그렇구나. 오늘 뭔 일 있었어?' },
        { type: 'empathy',   slot: 'b', text: '응, 같이 얘기하자.' },
        { type: 'empathy',   slot: 'c', text: '미안, 내 얘기만 했네.' },
        { type: 'criticism', slot: 'd', text: '나도 힘들었어.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '그렇구나. 오늘 뭔 일 있었어?' },
        { type: 'empathy',   slot: 'b', text: '응, 같이 얘기하자.' },
        { type: 'empathy',   slot: 'c', text: '미안, 내 얘기만 했네.' },
        { type: 'criticism', slot: 'd', text: '나도 힘들었어.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '관심 없는 거 아니야. 내가 너무 무심했어.' },
        { type: 'criticism', slot: 'b', text: '그런 말 하지 마.' },
        { type: 'empathy',   slot: 'c', text: '미안.' },
        { type: 'criticism', slot: 'd', text: '관심 없다고 하지 마.' },
      ],
    },
    A3: {
      a: [
        { type: 'empathy',   slot: 'a', text: '응, 쌓인 게 있어. 하나씩 얘기할 수 있어?' },
        { type: 'empathy',   slot: 'b', text: '응, 얘기해보자.' },
        { type: 'empathy',   slot: 'c', text: '오늘은 발표 얘기만 할게.' },
        { type: 'criticism', slot: 'd', text: '말해봤자 뭐가 달라져.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '고마워. 들어줘서.' },
        { type: 'avoidance', slot: 'b', text: '응.' },
        { type: 'criticism', slot: 'c', text: '다음엔 기억해줘.' },
        { type: 'criticism', slot: 'd', text: '맨날 몰랐다고 하면 어떡해.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '고마워. 들어줘서.' },
        { type: 'avoidance', slot: 'b', text: '응.' },
        { type: 'criticism', slot: 'c', text: '다음엔 기억해줘.' },
        { type: 'criticism', slot: 'd', text: '맨날 몰랐다고 하면 어떡해.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '힘들게 하려는 게 아니야. 그냥 알아줬으면 했어.' },
        { type: 'avoidance', slot: 'b', text: '…알겠어.' },
        { type: 'empathy',   slot: 'c', text: '미안.' },
        { type: 'avoidance', slot: 'd', text: '그래, 앞으로 말 안 할게.' },
      ],
    },
    B3: {
      a: [
        { type: 'empathy',   text: '응, 하나씩 얘기하자. 나 들을게.' },
        { type: 'empathy',   text: '어, 그러자.' },
        { type: 'empathy',   text: '미안했어, 진심으로.' },
        { type: 'avoidance', text: '어.' },
      ],
      b: [
        { type: 'empathy',   text: '응, 다음엔 꼭 기억할게.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '미안.' },
        { type: 'avoidance', text: '알겠어.' },
      ],
      c: [
        { type: 'empathy',   text: '응, 다음엔 꼭 기억할게.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '미안.' },
        { type: 'avoidance', text: '알겠어.' },
      ],
      d: [
        { type: 'empathy',   text: '그런 말 하지 마. 나 네 얘기 듣고 싶어.' },
        { type: 'empathy',   text: '…미안.' },
        { type: 'empathy',   text: '그러지 마.' },
        { type: 'avoidance', text: '그래.' },
      ],
    },
  },

  {
    id: 'card_bill',
    difficulty: 3,
    title: '반복되는 지출 갈등',
    icon: '💳',
    desc: '경제 문제와 정서 문제가 결합된 복합 갈등',
    room: { key: 'wall', label: '벽', icon: '🧱', statKey: 'trust' },
    bg: 'bg_bedroom.png',
    situation: n => `이번 달 카드값이 예상보다 많이 나왔어요. ${n.B}가 쓴 것 같은데, ${n.A}가 먼저 물어보려고 해요.`,
    A1: [
      { type: 'empathy',   slot: 'a', text: '이번 달 카드값 같이 한번 볼 수 있어? 좀 많이 나온 것 같아서.' },
      { type: 'criticism', slot: 'b', text: '이번 달 좀 많이 쓴 것 같아.' },
      { type: 'avoidance', slot: 'c', text: '요즘 돈 관리 어떻게 하고 있어?' },
      { type: 'criticism', slot: 'd', text: '이게 다 뭐야. 왜 이렇게 썼어.' },
    ],
    B1: {
      a: [
        { type: 'empathy',   slot: 'a', text: '응, 나 이번에 좀 썼어. 같이 보자.' },
        { type: 'avoidance', slot: 'b', text: '내가 좀 썼나? 뭔가 있었거든.' },
        { type: 'avoidance', slot: 'c', text: '많이 나왔어?' },
        { type: 'criticism', slot: 'd', text: '내 돈 내가 쓰는 게 문제야?' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '응, 내가 좀 썼어. 말했어야 했는데.' },
        { type: 'criticism', slot: 'b', text: '나? 필요한 거 샀는데.' },
        { type: 'avoidance', slot: 'c', text: '얼마나 나왔는데?' },
        { type: 'criticism', slot: 'd', text: '맨날 돈 얘기야.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '나 요즘 좀 많이 쓴 것 같아. 같이 정리해보자.' },
        { type: 'criticism', slot: 'b', text: '왜? 뭐가 문제야.' },
        { type: 'avoidance', slot: 'c', text: '그냥 쓰는 거지.' },
        { type: 'avoidance', slot: 'd', text: '내가 알아서 해.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '미안해. 말했어야 했는데. 요즘 스트레스 받아서…' },
        { type: 'criticism', slot: 'b', text: '필요해서 쓴 건데.' },
        { type: 'criticism', slot: 'c', text: '그렇게 말하면 서운하다.' },
        { type: 'criticism', slot: 'd', text: '당신은 안 써?' },
      ],
    },
    A2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '그래, 같이 보면서 정리해보자. 무슨 일 있었던 거야?' },
        { type: 'avoidance', slot: 'b', text: '응, 같이 보자.' },
        { type: 'criticism', slot: 'c', text: '왜 많이 쓴 거야? 무슨 일 있었어?' },
        { type: 'criticism', slot: 'd', text: '미리 말해줬으면 좋았을 텐데.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '필요한 거 맞는데, 같이 얘기하고 싶었어.' },
        { type: 'avoidance', slot: 'b', text: '그래, 알겠어.' },
        { type: 'empathy',   slot: 'c', text: '뭘 샀어?' },
        { type: 'criticism', slot: 'd', text: '필요한 거면 미리 말하지.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '응, 꽤 많이 나왔어. 같이 한번 보자.' },
        { type: 'avoidance', slot: 'b', text: '음… 그래.' },
        { type: 'empathy',   slot: 'c', text: '그렇게 말하면 나도 서운해.' },
        { type: 'criticism', slot: 'd', text: '그냥 쓰는 거면 안 되지.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '따지는 게 아니야. 같이 관리하고 싶어서.' },
        { type: 'avoidance', slot: 'b', text: '...알겠어.' },
        { type: 'empathy',   slot: 'c', text: '나도 써. 같이 얘기하자는 거야.' },
        { type: 'criticism', slot: 'd', text: '그게 대답이야?' },
      ],
    },
    B2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '응, 같이 보자. 사실 요즘 좀 힘들었어.' },
        { type: 'avoidance', slot: 'b', text: '어, 같이 보자.' },
        { type: 'empathy',   slot: 'c', text: '미안, 말했어야 했는데.' },
        { type: 'avoidance', slot: 'd', text: '꼭 같이 봐야 해?' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '요즘 좀 힘든 일이 있었어. 말 못 했네.' },
        { type: 'avoidance', slot: 'b', text: '그냥 좀 그랬어.' },
        { type: 'avoidance', slot: 'c', text: '별거 아니야.' },
        { type: 'criticism', slot: 'd', text: '왜 꼭 말해야 해.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '요즘 좀 힘든 일이 있었어. 말 못 했네.' },
        { type: 'avoidance', slot: 'b', text: '그냥 좀 그랬어.' },
        { type: 'avoidance', slot: 'c', text: '별거 아니야.' },
        { type: 'criticism', slot: 'd', text: '왜 꼭 말해야 해.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '맞아, 미리 말했어야 했어. 미안.' },
        { type: 'avoidance', slot: 'b', text: '...그럴게.' },
        { type: 'empathy',   slot: 'c', text: '나도 미안해.' },
        { type: 'criticism', slot: 'd', text: '맨날 뭐라 해.' },
      ],
    },
    A3: {
      a: [
        { type: 'empathy',   slot: 'a', text: '힘든 일 있었구나. 같이 보면서 얘기도 하자.' },
        { type: 'avoidance', slot: 'b', text: '응, 같이 보자.' },
        { type: 'empathy',   slot: 'c', text: '무슨 일이었어?' },
        { type: 'criticism', slot: 'd', text: '그러면 미리 말해줬으면 됐잖아.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '알겠어. 앞으로 미리 얘기하자.' },
        { type: 'avoidance', slot: 'b', text: '응.' },
        { type: 'empathy',   slot: 'c', text: '같이 관리하자.' },
        { type: 'criticism', slot: 'd', text: '맨날 이러면 나도 힘들어.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '알겠어. 앞으로 미리 얘기하자.' },
        { type: 'avoidance', slot: 'b', text: '응.' },
        { type: 'empathy',   slot: 'c', text: '같이 관리하자.' },
        { type: 'criticism', slot: 'd', text: '맨날 이러면 나도 힘들어.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '뭐라 하는 게 아니야. 같이 하고 싶어서.' },
        { type: 'avoidance', slot: 'b', text: '...알겠어.' },
        { type: 'empathy',   slot: 'c', text: '그냥 같이 보자.' },
        { type: 'avoidance', slot: 'd', text: '그래, 앞으로 신경 안 쓸게.' },
      ],
    },
    B3: {
      a: [
        { type: 'empathy',   text: '응, 같이 보자. 앞으로 미리 얘기할게.' },
        { type: 'empathy',   text: '어, 그러자.' },
        { type: 'empathy',   text: '미안했어.' },
        { type: 'avoidance', text: '어.' },
      ],
      b: [
        { type: 'empathy',   text: '응, 같이 관리하자.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '미안.' },
        { type: 'avoidance', text: '알겠어.' },
      ],
      c: [
        { type: 'empathy',   text: '응, 같이 관리하자.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '미안.' },
        { type: 'avoidance', text: '알겠어.' },
      ],
      d: [
        { type: 'empathy',   text: '신경 꺼달라는 게 아니야. 같이 하고 싶어.' },
        { type: 'empathy',   text: '...미안.' },
        { type: 'empathy',   text: '나도 미안해.' },
        { type: 'avoidance', text: '그래.' },
      ],
    },
  },



  {
    id: 'blowup',
    difficulty: 3,
    title: '누적된 회피 끝의 폭발',
    icon: '💥',
    desc: '쌓여있던 감정이 작은 일로 터져 나오는 상황',
    room: { key: 'bedroom', label: '침실', icon: '🛏️', statKey: 'intimacy' },
    bg: 'bg_bedroom.png',
    situation: n => `${n.A}가 별 뜻 없이 던진 말 한마디에 ${n.B}가 갑자기 평소와 다르게 화를 냈어요. 작은 일인데 반응이 너무 커서 ${n.A}는 당황스러워요.`,
    A1: [
      { type: 'empathy',   slot: 'a', text: '갑자기 많이 화났구나. 내가 뭔가 잘못한 게 있어?' },
      { type: 'criticism', slot: 'b', text: '왜 갑자기 화내는 거야.' },
      { type: 'avoidance', slot: 'c', text: '...(아무 말 없이 기다린다)' },
      { type: 'criticism', slot: 'd', text: '그 작은 걸로 왜 이렇게 과민반응이야.' },
    ],
    B1: {
      a: [
        { type: 'empathy',   slot: 'a', text: '미안, 이것만이 아니야. 오랫동안 말 못 했던 게 있어.' },
        { type: 'avoidance', slot: 'b', text: '아니, 그냥 오늘 좀 힘들었어.' },
        { type: 'avoidance', slot: 'c', text: '잠깐만.' },
        { type: 'criticism', slot: 'd', text: '지금 사과하면 다 해결되는 줄 알아?' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '갑자기가 아니야. 오래됐어.' },
        { type: 'avoidance', slot: 'b', text: '그냥 오늘 예민했어.' },
        { type: 'avoidance', slot: 'c', text: '말하기 싫어.' },
        { type: 'criticism', slot: 'd', text: '갑자기가 아니거든.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '...사실 많이 쌓였어. 그냥 넘어갔는데 오늘은 못 넘어가겠어.' },
        { type: 'avoidance', slot: 'b', text: '...됐어. (방으로 들어감)' },
        { type: 'avoidance', slot: 'c', text: '...말하기 싫어.' },
        { type: 'criticism', slot: 'd', text: '뭘 그렇게 쳐다봐.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '과민반응처럼 보였겠지만, 나 진짜 많이 참았어.' },
        { type: 'avoidance', slot: 'b', text: '그냥 오늘 힘들었어.' },
        { type: 'criticism', slot: 'c', text: '과민반응 아니야.' },
        { type: 'criticism', slot: 'd', text: '맞아, 나 원래 이렇게 예민해. 그게 문제야?' },
      ],
    },
    A2: {
      a: [
        { type: 'empathy',   slot: 'a', text: '말해줘서 고마워. 그동안 많이 힘들었겠다.' },
        { type: 'empathy',   slot: 'b', text: '그래? 뭔데. 말해봐.' },
        { type: 'criticism', slot: 'c', text: '몰랐어. 왜 말 안 했어?' },
        { type: 'criticism', slot: 'd', text: '그럼 진작 말하지.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '지금 말하기 어려우면 나중에 얘기하자. 기다릴게.' },
        { type: 'avoidance', slot: 'b', text: '(그냥 둔다)' },
        { type: 'empathy',   slot: 'c', text: '잠깐, 가지 마.' },
        { type: 'criticism', slot: 'd', text: '그렇게 피하면 아무것도 안 해결돼.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '강요 안 할게. 준비되면 말해줘.' },
        { type: 'avoidance', slot: 'b', text: '그래, 알겠어.' },
        { type: 'empathy',   slot: 'c', text: '언제든 말해줘.' },
        { type: 'criticism', slot: 'd', text: '말을 해야 알지.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '예민한 게 나쁜 게 아니야. 그냥 네가 어떤지 알고 싶어.' },
        { type: 'avoidance', slot: 'b', text: '...그래.' },
        { type: 'criticism', slot: 'c', text: '그런 말 하지 마.' },
        { type: 'criticism', slot: 'd', text: '그게 변명이야?' },
      ],
    },
    B2: {
      a: [
        { type: 'empathy', slot: 'a', text: '사실 나 요즘 많이 힘들었어. 너한테 말하기 어려웠어.' },
        { type: 'empathy', slot: 'b', text: '미안, 좀 진정하고 얘기하자.' },
        { type: 'empathy', slot: 'c', text: '고마워.' },
        { type: 'avoidance', slot: 'd', text: '됐어.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '...고마워. 잠깐만 있다가 나올게.' },
        { type: 'avoidance', slot: 'b', text: '...됐어.' },
        { type: 'empathy',   slot: 'c', text: '미안.' },
        { type: 'avoidance', slot: 'd', text: '혼자 있고 싶어.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '...고마워. 잠깐만 있다가 나올게.' },
        { type: 'avoidance', slot: 'b', text: '...됐어.' },
        { type: 'empathy',   slot: 'c', text: '미안.' },
        { type: 'avoidance', slot: 'd', text: '혼자 있고 싶어.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '피하는 게 아니라 지금 말하면 더 크게 싸울 것 같아서.' },
        { type: 'empathy',   slot: 'b', text: '미안.' },
        { type: 'avoidance', slot: 'c', text: '나중에 얘기하자.' },
        { type: 'avoidance', slot: 'd', text: '그래, 안 해결되면 어때.' },
      ],
    },
    A3: {
      a: [
        { type: 'empathy',   slot: 'a', text: '그랬구나. 말하기 어려웠겠다. 하나씩 얘기해줘.' },
        { type: 'empathy',   slot: 'b', text: '응, 천천히 얘기하자.' },
        { type: 'empathy',   slot: 'c', text: '뭐가 힘들었어?' },
        { type: 'criticism', slot: 'd', text: '왜 진작 말 안 했어.' },
      ],
      b: [
        { type: 'empathy',   slot: 'a', text: '응, 기다릴게. 준비되면 나와.' },
        { type: 'avoidance', slot: 'b', text: '...알겠어.' },
        { type: 'empathy',   slot: 'c', text: '천천히 해.' },
        { type: 'criticism', slot: 'd', text: '얼마나 기다려야 해.' },
      ],
      c: [
        { type: 'empathy',   slot: 'a', text: '응, 기다릴게. 준비되면 나와.' },
        { type: 'avoidance', slot: 'b', text: '...알겠어.' },
        { type: 'empathy',   slot: 'c', text: '천천히 해.' },
        { type: 'criticism', slot: 'd', text: '얼마나 기다려야 해.' },
      ],
      d: [
        { type: 'empathy',   slot: 'a', text: '그 말 상처돼. 나 네 편인데.' },
        { type: 'avoidance', slot: 'b', text: '...알겠어.' },
        { type: 'criticism', slot: 'c', text: '그러지 마.' },
        { type: 'avoidance', slot: 'd', text: '그래, 나도 모르겠다.' },
      ],
    },
    B3: {
      a: [
        { type: 'empathy', text: '응, 하나씩 얘기할게. 기다려줘서 고마워.' },
        { type: 'empathy', text: '어, 고마워.' },
        { type: 'empathy', text: '미안했어.' },
        { type: 'avoidance', text: '어.' },
      ],
      b: [
        { type: 'empathy',   text: '응, 나올게. 미안해.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '고마워.' },
        { type: 'avoidance', text: '알겠어.' },
      ],
      c: [
        { type: 'empathy',   text: '응, 나올게. 미안해.' },
        { type: 'avoidance', text: '어.' },
        { type: 'empathy',   text: '고마워.' },
        { type: 'avoidance', text: '알겠어.' },
      ],
      d: [
        { type: 'empathy', text: '네 편인 거 알아. 미안해.' },
        { type: 'empathy', text: '...미안.' },
        { type: 'empathy', text: '나도 미안해.' },
        { type: 'avoidance', text: '그래.' },
      ],
    },
  },
];

/* =========================================================
   사랑지도(Love Map) 질문 — 집(데일리) + 5개 여행지
   AI 파트너의 실제 답변은 미리 준비되어 있음
   ========================================================= */

// 🏠 집 — 데일리 질문 (일상/취향 ↔ 우리의 관계, 초급 → 중급 → 고급 순으로 번갈아 등장)
const HOME_DAILY_QUESTIONS = [
  { q: '하루 중 가장 좋아하는 시간대가 언제야?', aiAnswer: '나는 아침에 커피 한 잔 마실 때가 제일 좋아. 조용하고 여유로운 느낌이 들거든.' },
  { q: '우리가 함께할 때 제일 좋은 순간이 언제야?', aiAnswer: '별일 없이 같이 밥 먹으면서 시시콜콜한 얘기할 때가 제일 좋아.' },
  { q: '요즘 자주 먹는 음식이 뭐야?', aiAnswer: '요즘은 계속 김치찌개가 땡기더라. 거의 일주일에 두세 번은 먹는 것 같아.' },
  { q: '내가 가장 잘한다고 생각하는 게 뭐야?', aiAnswer: '넌 사람 말을 끝까지 잘 들어줘. 그게 진짜 큰 장점이라고 생각해.' },
  { q: '집에서 쉴 때 주로 뭐 해?', aiAnswer: '그냥 누워서 유튜브 보거나 휴대폰 만지는 게 제일 좋아.' },
  { q: '우리가 같이 해보고 싶은 게 있어?', aiAnswer: '여행 한 번 같이 가보고 싶어. 멀지 않아도 1박이라도 좋아.' },
  { q: '좋아하는 날씨가 어떤 날씨야?', aiAnswer: '햇볕 따뜻하고 바람 살짝 부는 날씨가 제일 좋아. 너무 덥거나 추운 건 별로야.' },
  { q: '나랑 있을 때 제일 편한 순간이 언제야?', aiAnswer: '아무 말 안 해도 어색하지 않을 때, 그게 제일 편해.' },
  { q: '혼자만의 시간이 생기면 제일 먼저 하고 싶은 게 뭐야?', aiAnswer: '아무 생각 없이 산책 한 바퀴 돌고 싶어. 그냥 걷는 게 머리를 비우는 데 도움이 되더라.' },
  { q: '우리 관계에서 더 많아졌으면 하는 게 있어?', aiAnswer: '서로 칭찬하는 말? 잘했다는 말을 좀 더 자주 해주면 좋을 것 같아.' },
  { q: '요즘 꽂혀 있는 게 있어? 노래든, 유튜브든, 뭐든.', aiAnswer: '요즘 자기 전에 보는 브이로그 채널이 하나 있는데, 그거 보면서 잠드는 게 습관이 됐어.' },
  { q: '내가 모르는 나의 습관 중에 신경 쓰이는 게 있어?', aiAnswer: '음... 가끔 말하다가 휴대폰 보는 거, 그게 살짝 서운할 때 있어.' },
  { q: '스트레스 받을 때 네가 가장 찾게 되는 게 뭐야?', aiAnswer: '단 거. 초콜릿이나 빵 같은 거 먹으면 잠깐이라도 풀리는 느낌이야.' },
  { q: '우리가 싸울 때 네가 가장 힘든 부분이 뭐야?', aiAnswer: '대화가 멈추는 거. 서로 말을 안 하게 되는 그 정적이 제일 힘들어.' },
  { q: '네가 정말 즐기고 있는 건데 나한테 말 안 한 취미나 관심사가 있어?', aiAnswer: '사실 요즘 식물 키우는 거에 관심이 생겼는데, 별거 아닌 것 같아서 말 안 했어.' },
  { q: '우리 관계에서 아직 해결 안 된 것 같은 게 있어?', aiAnswer: '집안일 분담 얘기, 그건 아직도 가끔 부딪히는 것 같아.' },
  { q: '요즘 삶에서 가장 의미 있다고 느끼는 순간이 언제야?', aiAnswer: '퇴근하고 집에 와서 너랑 별일 없이 이야기 나누는 시간, 그게 요즘 제일 의미 있는 것 같아.' },
  { q: '나한테 하고 싶었는데 못 했던 말이 있어?', aiAnswer: '고맙다는 말을 좀 더 자주 하고 싶었는데, 막상 말하려면 쑥스럽더라.' },
  { q: '지금 네 일상에서 바꾸고 싶은 게 있다면 뭐야?', aiAnswer: '잠을 좀 더 일정한 시간에 자고 싶어. 요즘 너무 늦게 자는 것 같아서.' },
  { q: '10년 후에 우리가 어떤 모습이길 바라?', aiAnswer: '지금처럼 서로 편하게 이야기할 수 있는 사이로 계속 남아 있었으면 좋겠어.' },
];

// 🗺️ 여행지 — 깊은 탐색 (순서대로 해금, 각 10문항)
const TRAVEL_DESTINATIONS = [
  {
    key: 'ulleungdo',
    name: '울릉도',
    icon: '🌿',
    subtitle: '어린 시절과 기억',
    tagline: '너를 만든 시간들이 궁금해',
    completeMessage: '울릉도 여행을 마쳤어요. 파트너의 과거가 조금 더 선명해졌어요.\n다음 여행지 부산이 열렸어요. 🌊',
    questions: [
      { q: '어릴 때 제일 좋아했던 음식이 뭐야?', aiAnswer: '할머니가 해주신 된장찌개. 지금도 그 맛은 못 따라가는 것 같아.' },
      { q: '초등학교 때 제일 친했던 친구 기억해?', aiAnswer: '응, 짝꿍이었던 애랑 진짜 친했어. 지금은 연락 안 하지만 가끔 생각나.' },
      { q: '어릴 때 방학이면 주로 뭐 했어?', aiAnswer: '동네 친구들이랑 해질 때까지 밖에서 놀았어. 집에 늦게 들어가서 혼나기도 했고.' },
      { q: '어릴 때 제일 좋아했던 장난감이나 물건이 있어?', aiAnswer: '낡은 곰인형 하나가 있었는데, 그게 없으면 잠을 못 잘 정도였어.' },
      { q: '어린 시절 가장 행복했던 기억이 뭐야?', aiAnswer: '가족이랑 다 같이 처음 바다 보러 갔던 날. 그날 분위기가 아직도 기억나.' },
      { q: '자라면서 가장 많이 들었던 말이 뭐야?', aiAnswer: "'조심해'라는 말을 진짜 많이 들었어. 부모님이 걱정이 많으셨거든." },
      { q: '부모님한테 배운 것 중에 지금도 네 삶에 남아 있는 게 있어?', aiAnswer: '밥은 꼭 챙겨 먹어야 한다는 거. 별거 아닌데 그게 습관처럼 남아 있어.' },
      { q: '어린 시절에 받은 상처 중에 아직 마음에 남아 있는 게 있어?', aiAnswer: '친구들 앞에서 부모님끼리 다투시는 걸 본 적이 있는데, 그 기억이 가끔 떠올라.' },
      { q: '자라면서 "이건 내가 절대 안 하겠다"고 다짐한 게 있어?', aiAnswer: '감정 상한다고 아무 말 없이 며칠씩 화내는 거, 그건 절대 안 하겠다고 생각했어.' },
      { q: '어릴 때의 네 모습 중에 지금도 네 안에 있다고 느끼는 게 뭐야?', aiAnswer: '낯선 사람 앞에서 좀 긴장하는 거, 그건 어릴 때부터 지금까지 똑같은 것 같아.' },
    ],
  },
  {
    key: 'busan',
    name: '부산',
    icon: '🌊',
    subtitle: '스트레스와 걱정',
    tagline: '요즘 많이 힘들진 않아?',
    completeMessage: '부산 여행을 마쳤어요. 파트너의 무게를 조금 나눠 가졌어요.\n다음 여행지 강원도가 열렸어요. 🏔️',
    questions: [
      { q: '요즘 가장 피곤하게 만드는 게 뭐야?', aiAnswer: '퇴근하고도 계속 생각나는 일거리들, 그게 제일 피곤해.' },
      { q: '일주일 중 제일 힘든 날이 언제야?', aiAnswer: '월요일. 한 주가 시작된다는 생각만 해도 좀 무거워.' },
      { q: '잠들기 전에 가장 많이 드는 생각이 뭐야?', aiAnswer: '내일 할 일들 정리하는 생각? 그러다 보면 잠이 늦어지더라.' },
      { q: '요즘 밥은 잘 먹고 있어?', aiAnswer: '그냥 그래. 바쁘면 대충 때울 때도 많아.' },
      { q: '지금 가장 부담스러운 게 있다면 뭐야?', aiAnswer: '회사에서 새로 맡은 일이 있는데, 잘 해낼 수 있을지 부담이 좀 있어.' },
      { q: '겉으로는 괜찮아 보이는데 사실 힘든 부분이 있어?', aiAnswer: '사람들 앞에서는 괜찮은 척하는데, 사실 체력적으로 좀 지쳐 있어.' },
      { q: '누구한테도 말 못 하고 혼자 안고 있는 걱정이 있어?', aiAnswer: '건강 검진 결과가 좀 신경 쓰이는데, 별일 아닐 거라고 생각하면서 넘기고 있어.' },
      { q: '요즘 나한테 말하기 어려웠던 게 있어?', aiAnswer: '요즘 좀 예민했던 것 같은데, 그게 너 때문이 아니라고 말하고 싶었어.' },
      { q: '지금 네 삶에서 가장 지치게 만드는 게 뭔지 솔직하게 말해줄 수 있어?', aiAnswer: '끝이 안 보이는 일들, 해도 해도 줄지 않는 느낌이 제일 지치게 해.' },
      { q: '내가 모르고 있는 네 걱정이나 두려움이 있다면 뭐야?', aiAnswer: '사실 요즘 일이 잘 안 풀릴까봐 걱정이 좀 있어. 너한테는 괜한 걱정 끼치고 싶지 않았어.' },
    ],
  },
  {
    key: 'gangwon',
    name: '강원도',
    icon: '🏔️',
    subtitle: '두려움과 불안',
    tagline: '네 마음 깊은 곳이 궁금해',
    completeMessage: '강원도 여행을 마쳤어요. 파트너의 두려움을 알게 된 것만으로도 큰 용기가 필요했어요.\n다음 여행지 거제가 열렸어요. 🐚',
    questions: [
      { q: '살면서 가장 무서웠던 경험이 뭐야?', aiAnswer: '예전에 가족이 갑자기 응급실에 간 적이 있었는데, 그때가 진짜 무서웠어.' },
      { q: '혼자 있을 때 드는 생각 중에 불안한 게 있어?', aiAnswer: '갑자기 미래에 대한 생각이 들면서 막연히 불안해질 때가 있어.' },
      { q: '가장 싫어하는 상황이나 환경이 있어?', aiAnswer: '사람 많고 시끄러운 곳. 그런 데 있으면 빨리 벗어나고 싶어져.' },
      { q: '지금 네 삶에서 가장 불확실하게 느껴지는 게 뭐야?', aiAnswer: '앞으로 일이 어떻게 풀릴지, 그게 가장 불확실하게 느껴져.' },
      { q: '실패가 두려워서 시도 못 한 게 있어?', aiAnswer: '예전부터 배워보고 싶었던 게 있는데, 시작하면 못 따라갈까봐 미루고 있어.' },
      { q: '사람들한테 들키고 싶지 않은 모습이 있어?', aiAnswer: '쉽게 불안해하는 모습. 겉으론 안 그런 척하는데 속으론 좀 그래.' },
      { q: '가장 자신 없는 부분이 어디야?', aiAnswer: '감정을 솔직하게 표현하는 거. 그게 제일 어려운 것 같아.' },
      { q: '나한테 버려질 것 같다는 느낌이 든 적 있어?', aiAnswer: '가끔 네가 말없이 조용해질 때, 잠깐 그런 생각이 스칠 때가 있긴 해.' },
      { q: '관계에서 가장 두려운 게 뭐야?', aiAnswer: '서로 멀어지는 걸 못 느끼고 지나가는 거. 그게 가장 두려워.' },
      { q: '나한테도 말하기 어려운 네 안의 두려움이 있다면 뭐야?', aiAnswer: '내가 충분히 잘하고 있는 사람인지, 가끔 그게 자신이 없을 때가 있어.' },
    ],
  },
  {
    key: 'geoje',
    name: '거제',
    icon: '🐚',
    subtitle: '사랑과 애정 표현',
    tagline: '너는 어떻게 사랑받고 싶어?',
    completeMessage: '거제 여행을 마쳤어요. 파트너가 사랑을 느끼는 방식을 알게 됐어요.\n마지막 여행지 제주도가 열렸어요. 🍊',
    questions: [
      { q: '내가 했던 것 중에 가장 고마웠던 게 뭐야?', aiAnswer: '내가 힘들어할 때 그냥 옆에 있어준 거. 별말 안 해도 그게 큰 위로였어.' },
      { q: '사랑받는다고 느낄 때가 언제야?', aiAnswer: '네가 내 얘기를 진심으로 들어줄 때, 그때 사랑받는다고 느껴.' },
      { q: '내가 자주 해줬으면 하는 게 있어?', aiAnswer: '가끔 먼저 안아주는 거, 그게 좋더라.' },
      { q: '기념일이나 특별한 날, 어떻게 보내는 걸 좋아해?', aiAnswer: '거창하지 않아도 둘이 맛있는 거 먹으면서 천천히 보내는 게 좋아.' },
      { q: '내가 무심코 했는데 사실 서운했던 적 있어?', aiAnswer: '약속 시간에 자주 늦는 거, 그게 사실 좀 서운했어.' },
      { q: '말보다 행동으로 사랑을 더 느끼는 편이야, 아니면 반대야?', aiAnswer: '행동 쪽인 것 같아. 작은 거라도 챙겨주는 게 더 크게 느껴져.' },
      { q: '내가 너한테 더 표현해줬으면 하는 게 있어?', aiAnswer: '고맙다는 말, 그걸 좀 더 자주 들으면 좋겠어.' },
      { q: '나한테 받은 사랑 중에 가장 기억에 남는 순간이 언제야?', aiAnswer: '내가 많이 힘들었을 때, 아무 말 없이 옆에서 손 잡아줬던 순간이 제일 기억나.' },
      { q: '사랑하지만 말하기 어려웠던 게 있어?', aiAnswer: '고맙고 소중하다는 마음, 그게 막상 말로 하려면 어색해서 잘 못 했던 것 같아.' },
      { q: '네가 생각하는 이상적인 우리 관계는 어떤 모습이야?', aiAnswer: '서로 부담 없이 솔직하게 말할 수 있는 사이, 그게 제일 이상적인 것 같아.' },
    ],
  },
  {
    key: 'jeju',
    name: '제주도',
    icon: '🍊',
    subtitle: '꿈과 목표',
    tagline: '너는 어떤 삶을 꿈꿔?',
    completeMessage: '제주도 여행을 마쳤어요. 🍊\n우리 사랑지도가 완성됐어요. 두 사람이 함께 만든 지도예요.',
    questions: [
      { q: '올해 안에 꼭 해보고 싶은 게 있어?', aiAnswer: '운동을 좀 꾸준히 해보고 싶어. 매번 다짐만 하고 흐지부지됐거든.' },
      { q: '언젠가 꼭 가보고 싶은 곳이 있어?', aiAnswer: '북유럽 쪽, 오로라 같은 거 한 번쯔음 보고 싶어.' },
      { q: '어릴 때 되고 싶었던 게 뭐야?', aiAnswer: '어릴 땐 선생님이 되고 싶었어. 지금이랑 많이 다르지만.' },
      { q: '지금 배우고 싶은 게 있어?', aiAnswer: '요리를 좀 제대로 배워보고 싶어. 맨날 대충 하니까.' },
      { q: '5년 후에 어떤 모습으로 살고 싶어?', aiAnswer: '지금보다 좀 더 여유 있게, 일과 일상의 균형이 잡힌 모습으로 살고 싶어.' },
      { q: '지금 하는 일이 네 꿈이랑 얼마나 연결되어 있어?', aiAnswer: '완전히 같진 않지만, 그 안에서 배우는 게 나중에 도움이 될 거라고 생각해.' },
      { q: '돈이나 현실 걱정 없다면 지금 당장 뭘 하고 싶어?', aiAnswer: '한 달 정도 아무 계획 없이 여기저기 돌아다니고 싶어.' },
      { q: '살면서 꼭 이루고 싶은 게 있는데 아직 시작도 못 한 게 있어?', aiAnswer: '글 쓰는 거. 예전부터 쓰고 싶은 이야기가 있었는데 계속 미루고 있어.' },
      { q: '너한테 성공이란 어떤 의미야?', aiAnswer: '큰 걸 이루는 것보다, 매일을 후회 없이 보내는 게 성공이라고 생각해.' },
      { q: '죽기 전에 후회하지 않으려면 무엇을 해야 한다고 생각해?', aiAnswer: '좋아하는 사람들한테 마음을 더 많이 표현하는 거. 그게 제일 중요한 것 같아.' },
    ],
  },
];

// 예상 답변과 실제 답변을 비교해 "정확히 맞춤(exact)" / "비슷하게 맞춤(similar)" / "새로운 발견(new)"으로 판정
function compareLoveMapAnswers(predicted, actual) {
  const norm = s => (s || '').replace(/[\s.,!?~"'…]/g, '').toLowerCase();
  const p = norm(predicted);
  const a = norm(actual);
  if (!p) return 'new';
  if (p === a) return 'exact';

  const grams = s => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.substring(i, i + 2));
    return set;
  };
  const gp = grams(p);
  const ga = grams(a);
  if (gp.size === 0 || ga.size === 0) return 'new';
  let overlap = 0;
  gp.forEach(g => { if (ga.has(g)) overlap++; });
  // 예상 답변(짧은 경우가 많음)이 실제 답변 안에 얼마나 포함되는지를 기준으로 판단
  const ratio = overlap / gp.size;
  return ratio >= 0.3 ? 'similar' : 'new';
}

// 여행지 완성도(%) 계산 — 전체 문항 수 중 답변한 문항 수 기준
function destCompletion(destKey) {
  const dest = TRAVEL_DESTINATIONS.find(d => d.key === destKey);
  const answeredCount = state.lovemap.destinations[destKey].answeredCount;
  return Math.min(100, Math.round((answeredCount / dest.questions.length) * 100));
}

// 여행지 해금 여부 — 첫 여행지는 기본 해금, 이후는 이전 여행지 50% 이상 완료 시 해금
function destUnlocked(idx) {
  if (idx === 0) return true;
  return destCompletion(TRAVEL_DESTINATIONS[idx - 1].key) >= 50;
}

/* =========================================================
   상태
   ========================================================= */
const state = {
  names: { A: '나', B: '파트너' },
  gender: { A: 'male', B: 'female' },
  stats: { intimacy: 50, trust: 50, cooperation: 50, communication: 50, boundary: 50 },
  day: 1,
  activeTab: 'home',

  scenario: null,
  dialogueLog: [],
  choiceTypes: {},
  choiceSlots: {},
  choiceTags: {},
  lastDeltas: null,
  todayMission: null,
  todayMissionDay: 0,
  missionDone: false,
  playedScenarioIds: [],

  lovemapPhase: 'predict', // 'predict' -> 'myAnswer' -> 'reveal'
  lovemapTemp: {},
  lovemap: {
    homeIndex: 0,
    homeCurrentIdx: 0,
    homeAnswers: [],
    destinations: {
      ulleungdo: { answeredCount: 0, answers: [] },
      busan: { answeredCount: 0, answers: [] },
      gangwon: { answeredCount: 0, answers: [] },
      geoje: { answeredCount: 0, answers: [] },
      jeju: { answeredCount: 0, answers: [] },
    },
  },

  scenarioHistory: [],
};

/* =========================================================
   유틸
   ========================================================= */
function clamp(v) {
  return Math.max(0, Math.min(100, v));
}

// 배열을 무작위로 섞은 새 배열을 반환 (Fisher-Yates)
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function levelOf(value) {
  if (value >= 70) return 3;
  if (value >= 40) return 2;
  return 1;
}

// Day가 지날수록 더 높은 난이도의 상황이 등장
function difficultyCap(day) {
  return Math.min(3, Math.ceil(day / 2));
}

// 오늘의 난이도 범위 내에서, 최근에 나오지 않은 상황 위주로 랜덤 선택
function pickTodayMission(day) {
  const cap = difficultyCap(day);
  const pool = SCENARIO_POOL.filter(sc => sc.difficulty <= cap);
  const candidates = pool.length ? pool : SCENARIO_POOL;

  let fresh = candidates.filter(sc => !state.playedScenarioIds.includes(sc.id));
  if (!fresh.length) {
    state.playedScenarioIds = [];
    fresh = candidates;
  }

  const picked = fresh[Math.floor(Math.random() * fresh.length)];
  state.playedScenarioIds.push(picked.id);
  return picked;
}

function genderImg(gender) {
  return gender === 'female' ? 'char_wife.png' : 'char_husband.png';
}

/* 날씨 아이콘/라벨 매핑 (Open-Meteo WMO 코드) */
const WEATHER_CODES = {
  0: ['☀️', '맑음'], 1: ['🌤️', '대체로 맑음'], 2: ['⛅', '구름 조금'], 3: ['☁️', '흐림'],
  45: ['🌫️', '안개'], 48: ['🌫️', '안개'],
  51: ['🌦️', '이슬비'], 53: ['🌦️', '이슬비'], 55: ['🌦️', '이슬비'],
  61: ['🌧️', '비'], 63: ['🌧️', '비'], 65: ['🌧️', '강한 비'],
  66: ['🌧️', '어는 비'], 67: ['🌧️', '어는 비'],
  71: ['🌨️', '눈'], 73: ['🌨️', '눈'], 75: ['❄️', '폭설'], 77: ['❄️', '싸락눈'],
  80: ['🌦️', '소나기'], 81: ['🌦️', '소나기'], 82: ['⛈️', '강한 소나기'],
  85: ['🌨️', '눈 소나기'], 86: ['🌨️', '눈 소나기'],
  95: ['⛈️', '뇌우'], 96: ['⛈️', '뇌우(우박)'], 99: ['⛈️', '뇌우(우박)'],
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function weightedPick(options, weights) {
  const pool = options.map(opt => ({ opt, w: weights[opt.type] || 0.1 }));
  const total = pool.reduce((sum, p) => sum + p.w, 0);
  let r = Math.random() * total;
  for (const p of pool) {
    r -= p.w;
    if (r <= 0) return p.opt;
  }
  return pool[pool.length - 1].opt;
}

/* =========================================================
   App
   ========================================================= */
const App = {
  goTo(screenKey) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.getElementById('screen-' + screenKey).classList.add('active');
  },

  startGame() {
    const a = document.getElementById('input-nameA').value.trim();
    const b = document.getElementById('input-nameB').value.trim();
    state.names.A = a || '나';
    state.names.B = b || '파트너';
    this.goTo('main');
    this.switchTab('home');
  },

  /* ---------------- 성별 선택 ---------------- */
  selectGender(who, gender) {
    state.gender[who] = gender;
    document.querySelectorAll(`#gender-toggle-${who} .gender-btn`).forEach(btn => {
      btn.classList.toggle('active', btn.textContent === (gender === 'male' ? '남성' : '여성'));
    });
  },

  /* ---------------- 파트너 연동 (데모) ---------------- */
  simulateLink() {
    const status = document.getElementById('link-status');
    status.textContent = '✅ (데모) 파트너의 기기와 연동되었습니다! 같은 집에서 함께 시작합니다.';
  },

  /* ---------------- 상단 스탯바 ---------------- */
  refreshTopbar() {
    const s = state.stats;
    document.getElementById('top-intimacy').textContent = s.intimacy;
    document.getElementById('top-communication').textContent = s.communication;
    document.getElementById('top-cooperation').textContent = s.cooperation;
    document.getElementById('top-trust').textContent = s.trust;
    document.getElementById('top-day').textContent = state.day;
  },

  /* ---------------- 탭 전환 ---------------- */
  switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    this.refreshTopbar();
    const content = document.getElementById('tab-content');
    if (tab === 'home') content.innerHTML = this.renderHomeTab();
    if (tab === 'mission') content.innerHTML = this.renderMissionTab();
    if (tab === 'emotion') content.innerHTML = this.renderEmotionTab();
    if (tab === 'analysis') content.innerHTML = this.renderAnalysisTab();
    if (tab === 'settings') content.innerHTML = this.renderSettingsTab();
  },

  /* ---------------- 집 탭 ---------------- */
  renderHomeTab() {
    const s = state.stats;
    const overallAvg = (s.intimacy + s.trust + s.cooperation + s.communication) / 4;
    const cracked = s.trust <= 30;

    let message, mood;
    if (overallAvg >= 70) {
      message = '집 안 곳곳에 따뜻한 빛이 가득해요. 두 사람의 노력이 관계를 밝게 만들고 있어요.';
      mood = '😊';
    } else if (overallAvg >= 40) {
      message = '집은 평온한 분위기를 유지하고 있어요. 작은 상호작용들이 관계를 지탱하고 있습니다.';
      mood = '🙂';
    } else {
      message = '최근 갈등이 누적되어 집안 분위기가 다소 가라앉아 있어요. 서로의 마음을 들여다볼 시간이 필요해 보여요.';
      mood = '😟';
    }

    // 집 전체 상태(좋음/보통/나쁨)는 종합 평균으로 결정
    let houseImg;
    if (overallAvg >= 70) houseImg = 'house_good.png';
    else if (overallAvg >= 40) houseImg = 'house_normal.png';
    else houseImg = 'house_bad.png';
    const hour = new Date().getHours();
    const bgImg = (hour >= 6 && hour < 18) ? 'house_bg_am.png' : 'house_bg_pm.png';

    return `
      <div class="house-illustration${cracked ? ' cracked' : ''}">
        <img class="house-bg-layer" src="assets/${bgImg}" alt=""
             onerror="this.style.display='none';">
        <img class="house-layer" src="assets/${houseImg}" alt="우리의 집">

        <div class="house-overlay">
          <div class="wall-crack${cracked ? ' show' : ''}"></div>

          <div class="house-characters">
            <div class="house-char-wrap char-a">
              <div class="speech-bubble">${mood}</div>
              <img class="house-char" src="assets/${genderImg(state.gender.A)}" alt="">
            </div>
            <div class="house-char-wrap char-b">
              <img class="house-char" src="assets/${genderImg(state.gender.B)}" alt="">
            </div>
          </div>
        </div>
      </div>

      <div class="home-message">${message}${cracked ? '<br>🧱 신뢰도가 낮아 벽에 균열이 보여요.' : ''}</div>

      <button class="lovemap-home-card" onclick="App.openLoveMapQuestion('home')">
        <span class="lovemap-home-icon">🏠</span>
        <span class="lovemap-home-text">
          <strong>오늘의 질문</strong>
          <span>${escapeHtml(HOME_DAILY_QUESTIONS[state.lovemap.homeCurrentIdx].q)}</span>
        </span>
        <span class="lovemap-home-arrow">→</span>
      </button>
    `;
  },

  /* ---------------- 미션 탭 ---------------- */
  ensureTodayMission() {
    if (state.todayMissionDay !== state.day || !state.todayMission) {
      state.todayMission = pickTodayMission(state.day);
      state.todayMissionDay = state.day;
      state.missionDone = false;
    }
  },

  renderMissionTab() {
    this.ensureTodayMission();
    const sc = state.todayMission;

    if (state.missionDone) {
      return `
        <div class="home-title">오늘의 상황</div>
        <div class="mission-card done-card">
          <span class="mission-icon">✅</span>
          <span class="mission-text">
            <strong>오늘의 상황이 종료되었어요</strong>
            <span>내일 새로운 상황이 발생할 거예요.</span>
          </span>
        </div>
      `;
    }

    return `
      <div class="home-title">오늘의 상황</div>
      <button class="alert-card" onclick="App.startScenario()">
        <span class="alert-bell">🔔</span>
        <span class="alert-text">
          <strong>${escapeHtml(sc.room.label)}에서 상황 발생!</strong>
          <span>탭하여 확인하기</span>
        </span>
        <span class="alert-badge">NEW</span>
      </button>
    `;
  },

  /* ---------------- 감정 탭 ---------------- */
  renderEmotionTab() {
    const allComplete = TRAVEL_DESTINATIONS.every(d => destCompletion(d.key) >= 50);

    const homeCount = state.lovemap.homeAnswers.length;

    return `
      <div class="home-title">사랑지도 여행</div>
      <img class="map-banner" src="assets/map_islands.png" alt="사랑지도">
      ${allComplete ? `<div class="home-message">🎉 우리의 사랑지도가 완성됐어요! 5개의 여행지를 모두 절반 이상 채웠어요.</div>` : ''}
      ${homeCount === 0 ? `
        <button class="lovemap-card locked" disabled>
          <span class="lovemap-icon">🏠</span>
          <span class="lovemap-text">
            <strong>우리집</strong>
            <span>오늘의 질문에 답하면 이야기가 쌓여요</span>
          </span>
        </button>
      ` : `
        <button class="lovemap-card" onclick="App.showHomeMemories()">
          <span class="lovemap-icon">🏠</span>
          <span class="lovemap-text">
            <strong>우리집</strong>
            <span>지금까지 나눈 오늘의 질문 이야기</span>
          </span>
          <span class="lovemap-badge">${homeCount}개</span>
        </button>
      `}
      ${TRAVEL_DESTINATIONS.map((dest, idx) => {
        const unlocked = destUnlocked(idx);
        const pct = destCompletion(dest.key);
        if (!unlocked) {
          return `
            <button class="lovemap-card locked" disabled>
              <span class="lovemap-icon">🔒</span>
              <span class="lovemap-text">
                <strong>${escapeHtml(dest.name)}</strong>
                <span>이전 여행지를 50% 이상 채우면 열려요</span>
              </span>
            </button>
          `;
        }
        return `
          <button class="lovemap-card" onclick="App.openLoveMapQuestion('${dest.key}')">
            <span class="lovemap-icon">${dest.icon}</span>
            <span class="lovemap-text">
              <strong>${escapeHtml(dest.name)} · ${escapeHtml(dest.subtitle)}</strong>
              <span>${escapeHtml(dest.tagline)}</span>
              <span class="lovemap-progress-bar"><span class="lovemap-progress-fill" style="width:${pct}%"></span></span>
            </span>
            <span class="lovemap-badge${pct >= 100 ? ' done' : ''}">${pct}%</span>
          </button>
        `;
      }).join('')}
    `;
  },

  /* ---------------- 분석 탭 ---------------- */
  findExampleSituation(category) {
    for (let i = state.scenarioHistory.length - 1; i >= 0; i--) {
      const entry = state.scenarioHistory[i];
      for (const turnKey of TURN_ORDER) {
        if (entry.choiceTags[turnKey].gottman === category) {
          return entry.title;
        }
      }
    }
    return null;
  },

  computeAnalysis() {
    const history = state.scenarioHistory;
    const total = history.length * TURN_ORDER.length;
    if (total === 0) return null;

    const gCounts = { 공감: 0, 비난: 0, 방어: 0, 경멸: 0, 담쌓기: 0, 중립: 0 };
    const gCountsA = { 공감: 0, 비난: 0, 담쌓기: 0, 중립: 0 };
    const gCountsB = { 공감: 0, 방어: 0, 담쌓기: 0, 중립: 0 };
    const bCounts = { 분화된반응: 0, 정서적융합: 0, 정서적단절: 0, 직접표현: 0, 간접표현: 0 };

    history.forEach(entry => {
      TURN_ORDER.forEach(turnKey => {
        const tag = entry.choiceTags[turnKey];
        gCounts[tag.gottman]++;
        (turnKey[0] === 'A' ? gCountsA : gCountsB)[tag.gottman]++;
        tag.bowen.forEach(b => bCounts[b]++);
      });
    });

    /* ----- Gottman ----- */
    const 비난율 = Math.round(gCounts.비난 / total * 100);
    const 방어율 = Math.round(gCounts.방어 / total * 100);
    const 경멸율 = Math.round(gCounts.경멸 / total * 100);
    const 담쌓기율 = Math.round(gCounts.담쌓기 / total * 100);
    const positive = gCounts.공감;
    const negative = gCounts.비난 + gCounts.방어 + gCounts.경멸 + gCounts.담쌓기;
    const ratioText = negative === 0
      ? `${positive}:0 (5:1 이상 충족)`
      : `${(positive / negative).toFixed(1)}:1`;
    const negPatterns = { 비난: 비난율, 방어: 방어율, 경멸: 경멸율, 담쌓기: 담쌓기율 };
    const dominantPattern = Object.entries(negPatterns).sort((a, b) => b[1] - a[1])[0][0];

    /* ----- Bowen ----- */
    const 분화된반응비율 = Math.round(bCounts.분화된반응 / total * 100);
    const 정서적융합비율 = Math.round(bCounts.정서적융합 / total * 100);
    const 정서적단절비율 = Math.round(bCounts.정서적단절 / total * 100);
    const directTotal = bCounts.직접표현 + bCounts.간접표현;
    const 직접의사소통비율 = directTotal === 0 ? null : Math.round(bCounts.직접표현 / directTotal * 100);

    let differentiationScore;
    if (직접의사소통비율 === null) {
      differentiationScore = 분화된반응비율 * (0.4 / 0.7)
        + (100 - 정서적융합비율) * (0.15 / 0.7)
        + (100 - 정서적단절비율) * (0.15 / 0.7);
    } else {
      differentiationScore = 분화된반응비율 * 0.4
        + 직접의사소통비율 * 0.3
        + (100 - 정서적융합비율) * 0.15
        + (100 - 정서적단절비율) * 0.15;
    }
    differentiationScore = Math.round(differentiationScore);

    let dominantTendency;
    if (differentiationScore >= 70) dominantTendency = '분화';
    else if (differentiationScore < 40) dominantTendency = 정서적융합비율 >= 정서적단절비율 ? '융합' : '단절';
    else dominantTendency = '균형';

    /* ----- 개인 패턴 ----- */
    const aDominant = Object.entries(gCountsA).sort((x, y) => y[1] - x[1])[0][0];
    const bDominant = Object.entries(gCountsB).sort((x, y) => y[1] - x[1])[0][0];

    return {
      total,
      gottman: { 비난율, 방어율, 경멸율, 담쌓기율, positive, negative, ratioText, negPatterns, dominantPattern },
      bowen: { 분화된반응비율, 정서적융합비율, 정서적단절비율, 직접의사소통비율, differentiationScore, dominantTendency },
      individual: { aDominant, bDominant },
    };
  },

  renderAnalysisTab() {
    const n = state.names;
    const analysis = this.computeAnalysis();

    if (!analysis) {
      return `
        <div class="home-title">우리의 대화 패턴 분석</div>
        <div class="home-message">아직 분석할 대화 기록이 없어요. "상황" 탭에서 상황극을 진행하면 우리의 대화 패턴이 차곡차곡 쌓여요.</div>
      `;
    }

    const { gottman, bowen } = analysis;
    const { 비난율, 방어율, 경멸율, 담쌓기율, positive, negative, ratioText, negPatterns, dominantPattern } = gottman;
    const { 분화된반응비율, 정서적융합비율, 정서적단절비율, 직접의사소통비율, differentiationScore, dominantTendency } = bowen;

    /* ----- Gottman 피드백 ----- */
    const gottmanSentences = [];
    if (positive > 0) {
      gottmanSentences.push(`따뜻한 공감의 순간이 ${positive}번 있었어요. 갈등 속에서도 서로를 향한 마음이 남아있다는 신호예요.`);
    } else {
      gottmanSentences.push('아직 공감의 순간이 뚜렷하게 나타나진 않았지만, 지금부터 하나씩 만들어갈 수 있어요.');
    }
    if (negPatterns[dominantPattern] > 0) {
      const exampleTitle = this.findExampleSituation(dominantPattern);
      const exampleText = exampleTitle ? ` 특히 "${exampleTitle}" 상황에서 이런 모습이 나타났어요.` : '';
      const dominantMsgMap = {
        비난: `대화에서 감정이 먼저 앞서는 순간들이 있었어요.${exampleText} 나쁜 게 아니라 그만큼 기대가 크다는 뜻이기도 해요.`,
        방어: `상대의 말에 방어적으로 반응하는 패턴이 보였어요.${exampleText} 방어는 자신을 지키려는 자연스러운 반응이에요.`,
        경멸: `상대를 깎아내리는 듯한 말투가 보였어요.${exampleText} 서로를 존중하는 표현으로 바꿔보면 분위기가 한결 달라질 거예요.`,
        담쌓기: `대화를 잠시 닫아두는 방식이 자주 나타났어요.${exampleText} 때로는 잠시 멈추는 것도 필요하지만, 작은 반응 하나가 생각보다 큰 연결을 만들어요.`,
      };
      gottmanSentences.push(dominantMsgMap[dominantPattern]);
    }
    if (negative === 0) {
      gottmanSentences.push('지금까지의 대화에서는 부정적인 표현보다 따뜻한 표현이 훨씬 많이 나타났어요. 좋은 흐름이 이어지고 있어요.');
    } else if (positive / negative >= 5) {
      gottmanSentences.push(`긍정 교류가 부정 교류보다 ${(positive / negative).toFixed(1)}배 많았어요. Gottman이 말한 건강한 관계의 기준인 5:1을 넘었어요. 지금 이 관계에 따뜻한 에너지가 흐르고 있어요.`);
    } else {
      gottmanSentences.push(`현재 긍정 교류와 부정 교류의 비율이 ${ratioText}예요. Gottman 연구에 따르면 관계가 안정적으로 유지되려면 5:1 이상이 필요해요. 지금 우리 관계에 따뜻한 교류가 조금 더 필요한 시점일 수 있어요.`);
    }
    const gottmanFeedback = gottmanSentences.join(' ');

    /* ----- Bowen 피드백 ----- */
    const bowenSentences = [];
    if (differentiationScore >= 70) {
      bowenSentences.push(`자아분화종합점수는 ${differentiationScore}점으로, 서로 다른 의견 속에서도 차분하게 자기 생각을 지키는 모습이 돋보여요. 건강한 분화의 신호예요.`);
    } else if (differentiationScore < 40) {
      if (dominantTendency === '융합') {
        bowenSentences.push(`자아분화종합점수는 ${differentiationScore}점으로, 상대의 감정에 깊이 휩쓸리거나 맞춰주려는 경향이 두드러져요. 가끔은 "나는 이렇게 생각해"라고 자신의 입장을 먼저 말해보는 것도 좋아요.`);
      } else {
        bowenSentences.push(`자아분화종합점수는 ${differentiationScore}점으로, 갈등 상황에서 서로 거리를 두는 경향이 두드러져요. 작은 대화 한 번이 그 거리를 좁히는 첫걸음이 될 수 있어요.`);
      }
    } else {
      bowenSentences.push(`자아분화종합점수는 ${differentiationScore}점으로, 보통 수준이에요. 연결과 자율성 사이에서 비교적 균형을 찾아가고 있어요.`);
    }
    if (정서적융합비율 >= 40) {
      bowenSentences.push('상대의 감정에 쉽게 동화되는 모습이 자주 나타났어요. 함께 느끼는 마음은 소중하지만, 자신의 생각도 함께 표현해보면 더 좋아요.');
    }
    if (정서적단절비율 >= 40) {
      bowenSentences.push('갈등이 생기면 마음의 문을 닫는 모습이 자주 나타났어요. 짧은 한마디라도 먼저 건네보는 연습이 도움이 될 수 있어요.');
    }
    if (직접의사소통비율 === null) {
      bowenSentences.push('아직 직접적인 의사소통 데이터가 충분하지 않아요. 다양한 상황극을 진행하면 더 정확한 분석이 가능해요.');
    } else if (직접의사소통비율 < 50) {
      bowenSentences.push(`직접적인 의사소통 비율은 ${직접의사소통비율}%예요. "나는 ~을 원해"처럼 마음을 직접 표현하는 연습이 관계를 더 명확하게 만들어줄 거예요.`);
    } else {
      bowenSentences.push(`직접적인 의사소통 비율은 ${직접의사소통비율}%예요. 필요한 순간에 마음을 직접 표현하는 모습이 자주 나타났어요. 이런 솔직함이 서로를 더 잘 이해하게 도와줘요.`);
    }
    if (분화된반응비율 < 30) {
      bowenSentences.push('차분하게 자기 생각을 지키며 반응하는 순간이 아직은 적었어요. 감정이 격해질 때 잠시 숨을 고르고 반응해보는 것도 도움이 될 수 있어요.');
    }
    const bowenFeedback = bowenSentences.join(' ');

    /* ----- 관계 요약 ----- */
    const statValues = Object.values(state.stats);
    const houseAvg = statValues.reduce((a, b) => a + b, 0) / statValues.length;
    let houseMessage;
    if (houseAvg >= 80) houseMessage = '우리 집이 따뜻하고 밝아요. 지금 이 관계에 좋은 에너지가 흐르고 있어요.';
    else if (houseAvg >= 60) houseMessage = '집 곳곳에 온기가 있어요. 조금씩 더 채워나갈 수 있어요.';
    else if (houseAvg >= 40) houseMessage = '집이 조금 흔들리고 있어요. 작은 연결 시도가 지금 필요한 시점이에요.';
    else if (houseAvg >= 20) houseMessage = '집에 균열이 생기고 있어요. 지금 우리 관계가 회복이 필요하다는 신호예요.';
    else houseMessage = '집이 많이 어두워졌어요. 지금 가장 필요한 건 작은 대화 한 번이에요.';

    let overallFeedback = `${gottmanSentences[0]} Gottman 지표로 보면 지금 우리의 긍정:부정 교류 비율은 ${ratioText} 수준이고, Bowen 지표로 보면 자아분화종합점수는 ${differentiationScore}점이에요. ${houseMessage} 이 숫자들은 평가가 아니라, 지금 우리가 어디쯤 있는지 비춰주는 거울일 뿐이에요.`;

    const allStatsLow = statValues.every(v => v <= 20);
    const allGottmanNegHigh = 비난율 >= 40 && 방어율 >= 40 && 담쌓기율 >= 40;
    const bothBowenHigh = 정서적단절비율 >= 70 && 정서적융합비율 >= 70;
    if (allStatsLow && allGottmanNegHigh && bothBowenHigh) {
      overallFeedback += ' 지금 관계가 많이 힘드신 것 같아요. 전문 상담사와 함께 이야기 나눠보시는 것도 좋은 선택이에요.';
    }

    const actionMap = {
      비난: '다음에 서운한 감정이 올라올 때, "나는 ~할 때 서운해"로 시작해서 말해봐요.',
      방어: '오늘 잠들기 전에 파트너에게 고마웠던 점 한 가지를 말해봐요.',
      경멸: '파트너가 좋아하는 것 한 가지를 떠올리고, 그걸 말로 표현해봐요.',
      담쌓기: '오늘 저녁, 파트너에게 "오늘 어땠어?"라고 한 번만 먼저 물어봐요.',
    };
    let actionSuggestion = negPatterns[dominantPattern] > 0 ? actionMap[dominantPattern] : null;
    if (!actionSuggestion) {
      actionSuggestion = 직접의사소통비율 !== null && 직접의사소통비율 < 50
        ? '이번 주에 마음속에 있는 작은 바람을 한 가지 말로 표현해봐요.'
        : '오늘 파트너에게 고마웠던 점 한 가지를 말해봐요.';
    }

    /* ----- 개인 패턴 ----- */
    const { aDominant, bDominant } = analysis.individual;
    const feedbackMapA = {
      공감: '자신의 마음을 꺼낼 때 상대의 감정을 먼저 살피는 표현을 선택하는 경향이 보여요. 이런 시도가 대화의 분위기를 부드럽게 만들어요.',
      비난: '서운한 마음이 들 때 감정이 먼저 표현되는 경향이 보여요. 그만큼 솔직한 마음이 있다는 뜻으로도 볼 수 있어요.',
      담쌓기: '갈등이 생기면 대화를 잠시 닫아두는 방식을 선택하는 경향이 보여요. 짧은 한마디라도 먼저 건네보면 분위기가 달라질 수 있어요.',
      중립: '갈등 상황에서 한 걸음 물러나 지켜보는 방식을 선택하는 경향이 보여요. 잠시 멈추는 것도 자신을 보호하는 방법 중 하나예요.',
    };
    const feedbackMapB = {
      공감: '상대의 말에 공감하며 반응하는 경향이 보여요. 이런 반응이 갈등을 키우지 않고 대화를 이어가게 해줘요.',
      방어: '지적받는 느낌이 들 때 자신을 설명하거나 방어하는 표현이 먼저 나오는 경향이 보여요. 이건 자신을 지키려는 자연스러운 반응이에요.',
      담쌓기: '상황이 무거워지면 대화를 잠시 닫아두는 방식을 선택하는 경향이 보여요. 혼자만의 시간이 필요한 신호일 수 있어요.',
      중립: '상황이 무거워지면 잠시 거리를 두고 지켜보는 방식을 선택하는 경향이 보여요. 혼자만의 시간이 필요한 신호일 수 있어요.',
    };

    return `
      <div class="home-title">우리의 대화 패턴 분석</div>

      <div class="analysis-chart">
        <div class="analysis-section-title">Gottman 지표 · 부정 패턴 비율</div>
        ${Object.entries(negPatterns).map(([key, val]) => `
          <div class="analysis-row">
            <span class="analysis-label">${key}</span>
            <div class="analysis-bar-track">
              <div class="analysis-bar-fill" style="width:${val}%; background:${{ 비난: '#e08a7a', 방어: '#f0b86e', 경멸: '#b85c4c', 담쌓기: '#c9a98a' }[key]};"></div>
            </div>
            <span class="analysis-count">${val}%</span>
          </div>
        `).join('')}
        <div class="analysis-ratio">긍정 : 부정 교류 비율 — ${ratioText}</div>
        <div class="analysis-feedback">${gottmanFeedback}</div>
      </div>

      <div class="analysis-chart">
        <div class="analysis-section-title">Bowen 지표 · 자아분화</div>
        <div class="analysis-row">
          <span class="analysis-label">자아분화</span>
          <div class="analysis-bar-track">
            <div class="analysis-bar-fill" style="width:${differentiationScore}%; background:#7eb6e0;"></div>
          </div>
          <span class="analysis-count">${differentiationScore}점</span>
        </div>
        <div class="analysis-row">
          <span class="analysis-label">정서적 융합</span>
          <div class="analysis-bar-track">
            <div class="analysis-bar-fill" style="width:${정서적융합비율}%; background:#e0a87a;"></div>
          </div>
          <span class="analysis-count">${정서적융합비율}%</span>
        </div>
        <div class="analysis-row">
          <span class="analysis-label">정서적 단절</span>
          <div class="analysis-bar-track">
            <div class="analysis-bar-fill" style="width:${정서적단절비율}%; background:#c9a98a;"></div>
          </div>
          <span class="analysis-count">${정서적단절비율}%</span>
        </div>
        <div class="analysis-row">
          <span class="analysis-label">직접적 의사소통</span>
          <div class="analysis-bar-track">
            <div class="analysis-bar-fill" style="width:${직접의사소통비율 ?? 0}%; background:#8fc99b;"></div>
          </div>
          <span class="analysis-count">${직접의사소통비율 === null ? '데이터부족' : `${직접의사소통비율}%`}</span>
        </div>
        <div class="analysis-row">
          <span class="analysis-label">분화된 반응</span>
          <div class="analysis-bar-track">
            <div class="analysis-bar-fill" style="width:${분화된반응비율}%; background:#c5b8a5;"></div>
          </div>
          <span class="analysis-count">${분화된반응비율}%</span>
        </div>
        <div class="analysis-ratio">자아분화종합점수 — ${differentiationScore}점 (${dominantTendency})</div>
        <div class="analysis-feedback">${bowenFeedback}</div>
      </div>

      <div class="home-message">${overallFeedback}</div>
      <div class="home-message">💡 이번 주 작은 실천: ${actionSuggestion}</div>

      <div class="home-title" style="margin-top:14px;">내 패턴 돌아보기</div>
      <div class="analysis-individual">
        <div class="analysis-individual-card">
          <strong>${escapeHtml(n.A)}</strong>
          <p>${feedbackMapA[aDominant]}</p>
        </div>
        <div class="analysis-individual-card">
          <strong>${escapeHtml(n.B)}</strong>
          <p>${feedbackMapB[bDominant]}</p>
        </div>
      </div>
    `;
  },

  /* ---------------- 설정 탭 ---------------- */
  renderSettingsTab() {
    const n = state.names;
    return `
      <div class="home-title">설정</div>
      <div class="settings-card">
        <div class="settings-row"><span>나의 이름</span><strong>${escapeHtml(n.A)}</strong></div>
        <div class="settings-row"><span>파트너 이름</span><strong>${escapeHtml(n.B)}</strong></div>
        <div class="settings-row"><span>현재 Day</span><strong>${state.day}</strong></div>
      </div>
      <button class="btn-secondary" onclick="App.resetGame()">처음부터 다시 시작하기</button>
      <div class="home-message">
        "우리(WooRi)"는 부부 관계 증진을 위한 가족치료 수업 시연용 데모입니다.<br>
        모든 진행 상황은 저장되지 않으며, 새로고침하거나 다시 시작하면 초기화됩니다.
      </div>
    `;
  },

  resetGame() {
    state.names = { A: '나', B: '파트너' };
    state.gender = { A: 'male', B: 'female' };
    state.stats = { intimacy: 50, trust: 50, cooperation: 50, communication: 50, boundary: 50 };
    state.day = 1;
    state.todayMission = null;
    state.todayMissionDay = 0;
    state.missionDone = false;
    state.playedScenarioIds = [];
    state.lovemap = {
      homeIndex: 0,
      homeCurrentIdx: 0,
      homeAnswers: [],
      destinations: {
        ulleungdo: { answeredCount: 0, answers: [] },
        busan: { answeredCount: 0, answers: [] },
        gangwon: { answeredCount: 0, answers: [] },
        geoje: { answeredCount: 0, answers: [] },
        jeju: { answeredCount: 0, answers: [] },
      },
    };
    state.scenarioHistory = [];
    document.getElementById('input-nameA').value = '';
    document.getElementById('input-nameB').value = '';
    document.getElementById('link-status').textContent = '';
    this.selectGender('A', 'male');
    this.selectGender('B', 'female');
    this.goTo('intro');
  },

  /* ---------------- 상황극 ---------------- */
  startScenario() {
    this.ensureTodayMission();
    state.scenario = state.todayMission;
    state.dialogueLog = [];
    state.choiceTypes = {};
    state.choiceSlots = {};
    state.choiceTags = {};

    const n = state.names;
    document.getElementById('scene-nameA').textContent = n.A;
    document.getElementById('scene-nameB').textContent = n.B;
    document.getElementById('scene-charA').src = `assets/${genderImg(state.gender.A)}`;
    document.getElementById('scene-charB').src = `assets/${genderImg(state.gender.B)}`;
    document.querySelector('#thinking-box .thinking-dots').textContent = `${n.B}가 응답을 작성하고 있어요`;
    document.getElementById('scene-illustration').style.backgroundImage =
      `url('assets/${state.scenario.bg}')`;

    this.goTo('scenario');
    this.renderTurn('A1');
  },

  exitScenario() {
    this.goTo('main');
    this.switchTab('mission');
  },

  getOptionsFor(turnKey) {
    const sc = state.scenario;
    if (turnKey === 'A1') return sc.A1;
    if (turnKey === 'B1') return sc.B1[state.choiceSlots.A1];
    if (turnKey === 'A2') return sc.A2[state.choiceSlots.B1];
    if (turnKey === 'B2') return sc.B2[state.choiceSlots.A2];
    if (turnKey === 'A3') return sc.A3[state.choiceSlots.B2];
    if (turnKey === 'B3') return sc.B3[state.choiceSlots.A3];
  },

  renderDialogueLog() {
    const n = state.names;
    const logEl = document.getElementById('dialogue-log');
    logEl.innerHTML = state.dialogueLog.map(entry => `
      <div class="log-entry speaker-${entry.speaker}">
        <div class="log-bubble">
          <span class="log-name">${escapeHtml(n[entry.speaker])}</span>
          ${escapeHtml(entry.text)}
        </div>
      </div>
    `).join('');
  },

  renderTurn(turnKey) {
    const n = state.names;
    const sc = state.scenario;

    document.getElementById('scenario-heading').textContent = `${sc.room.icon} ${sc.title}`;
    document.getElementById('thinking-box').classList.remove('active');
    document.getElementById('next-turn-btn').classList.add('hidden');

    this.renderDialogueLog();

    const promptEl = document.getElementById('turn-prompt');
    if (turnKey === 'A1') {
      promptEl.textContent = TURN_PROMPT.A1(n, sc.situation(n));
    } else {
      promptEl.textContent = TURN_PROMPT[turnKey](n);
    }

    const options = shuffle(this.getOptionsFor(turnKey).slice());
    state.currentOptions = options;
    const choiceEl = document.getElementById('choice-list');
    choiceEl.style.display = 'flex';
    choiceEl.innerHTML = '';
    options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = `choice-btn choice-${idx + 1}`;
      btn.innerHTML = `<span class="choice-num">${idx + 1}</span><span>${escapeHtml(opt.text)}</span>`;
      btn.onclick = () => this.selectChoice(turnKey, idx);
      choiceEl.appendChild(btn);
    });
  },

  selectChoice(turnKey, idx) {
    const options = state.currentOptions;
    const chosen = options[idx];
    state.choiceTypes[turnKey] = chosen.type;
    state.choiceSlots[turnKey] = chosen.slot;
    state.choiceTags[turnKey] = derivePatternTags(chosen, turnKey);
    state.dialogueLog.push({ speaker: 'A', text: chosen.text });

    this.renderDialogueLog();
    document.getElementById('turn-prompt').textContent = '';
    document.getElementById('choice-list').innerHTML = '';

    const thinkingBox = document.getElementById('thinking-box');
    thinkingBox.classList.add('active');

    const idxInOrder = TURN_ORDER.indexOf(turnKey);
    const aiTurnKey = TURN_ORDER[idxInOrder + 1]; // 'B1'/'B2'/'B3'
    state.pendingTurn = TURN_ORDER[idxInOrder + 2]; // 다음 플레이어 턴 ('A2'/'A3' or undefined)

    setTimeout(() => {
      thinkingBox.classList.remove('active');
      const aiOptions = this.getOptionsFor(aiTurnKey);
      const aiChoice = weightedPick(aiOptions, AI_RESPONSE_WEIGHTS[chosen.type]);
      state.choiceTypes[aiTurnKey] = aiChoice.type;
      state.choiceSlots[aiTurnKey] = aiChoice.slot;
      state.choiceTags[aiTurnKey] = derivePatternTags(aiChoice, aiTurnKey);
      state.dialogueLog.push({ speaker: 'B', text: aiChoice.text });
      this.renderDialogueLog();

      const nextBtn = document.getElementById('next-turn-btn');
      nextBtn.textContent = state.pendingTurn ? '다음' : '결과 보기';
      nextBtn.classList.remove('hidden');
    }, 1100);
  },

  proceedAfterReply() {
    if (state.pendingTurn) {
      this.renderTurn(state.pendingTurn);
    } else {
      this.finishScenario();
    }
  },

  finishScenario() {
    const types = TURN_ORDER.map(t => state.choiceTypes[t]);
    const counts = { empathy: 0, criticism: 0, avoidance: 0 };
    types.forEach(t => counts[t]++);

    state.scenarioHistory.push({
      title: state.scenario.title,
      choiceTypes: { ...state.choiceTypes },
      choiceTags: { ...state.choiceTags },
    });

    const deltas = { intimacy: 0, trust: 0, cooperation: 0, communication: 0, boundary: 0 };
    types.forEach(t => {
      const d = TYPE_DELTA[t];
      Object.keys(deltas).forEach(k => deltas[k] += d[k]);
    });

    Object.keys(state.stats).forEach(k => {
      state.stats[k] = clamp(state.stats[k] + deltas[k]);
    });
    state.lastDeltas = deltas;
    state.missionDone = true;

    const messages = [];
    if (counts.empathy >= 4) {
      messages.push('공감적 반응이 두드러지며, 갈등 상황에서도 정서적 연결을 유지하려는 시도가 나타났습니다.');
    } else if (counts.empathy >= 2) {
      messages.push('상대의 감정을 탐색하려는 시도가 나타났습니다. 공감적 반응이 관계 회복에 도움이 되었을 수 있습니다.');
    }
    if (counts.criticism >= 3) {
      messages.push('비난 표현이 반복되며 상대의 방어 반응을 유발했을 수 있습니다. "너는 항상 ~" 같은 표현 대신 "나는 ~할 때 이렇게 느꼈어" 같은 나-전달법을 시도해보면 어떨까요?');
    } else if (counts.criticism >= 1) {
      messages.push('비난의 표현이 나타났습니다. 감정을 표현할 때 상대를 평가하기보다 자신의 감정을 전달하는 방식이 도움이 될 수 있습니다.');
    }
    if (counts.avoidance >= 3) {
      messages.push('회피 패턴이 반복되며 갈등이 충분히 다뤄지지 못한 채 마무리되었습니다. 담쌓기는 단기적으로 갈등을 줄여주지만, 장기적으로는 거리감을 키울 수 있습니다.');
    } else if (counts.avoidance >= 1) {
      messages.push('잠시 회피하는 반응이 있었지만, 대화는 비교적 안정적으로 이어졌습니다.');
    }
    if (counts.criticism === 0 && counts.avoidance === 0) {
      messages.push('문제 해결보다 감정 확인이 먼저 이루어지며, 안정적인 대화가 이어졌습니다.');
    }
    if (messages.length === 0) {
      messages.push('이번 대화에서는 다양한 반응이 섞여 나타났습니다. 다음 상황에서는 상대의 감정을 먼저 확인해보는 것은 어떨까요?');
    }

    this.renderResult(messages, deltas);
  },

  renderResult(messages, deltas) {
    this.goTo('result');
    const sc = state.scenario;

    const totalDelta = Object.values(deltas).reduce((a, b) => a + b, 0);
    document.getElementById('result-illustration').textContent =
      totalDelta > 2 ? '💕✨' : (totalDelta < -2 ? '💧🏚️' : '🙂');

    document.getElementById('result-summary').innerHTML =
      messages.map(m => `<p>${escapeHtml(m)}</p>`).join('');

    const labels = { intimacy: '❤️ 친밀도', trust: '🛡️ 신뢰도', cooperation: '🤝 협력도', communication: '💬 소통점수', boundary: '🛁 경계존중' };
    document.getElementById('result-stats').innerHTML = Object.entries(deltas)
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => {
        const cls = v > 0 ? 'up' : 'down';
        const sign = v > 0 ? '+' : '';
        return `<div class="result-stat-chip ${cls}">${labels[k]} ${sign}${v}</div>`;
      }).join('');

    const roomDelta = deltas[sc.room.statKey];
    let roomMsg;
    if (roomDelta > 0) {
      roomMsg = `${sc.room.icon} ${sc.room.label}이(가) 더 환해졌어요!`;
    } else if (roomDelta < 0) {
      roomMsg = `${sc.room.icon} ${sc.room.label}의 분위기가 조금 가라앉았어요...`;
    } else {
      roomMsg = `${sc.room.icon} ${sc.room.label}은(는) 큰 변화 없이 유지되었어요.`;
    }
    document.getElementById('result-room').textContent = roomMsg;
  },

  applyResultsAndGoHome() {
    state.day += 1;
    this.goTo('main');
    this.switchTab('home');
  },

  /* ---------------- 사랑지도 ---------------- */
  // source: 'home' 또는 여행지 key (ulleungdo/busan/gangwon/geoje/jeju)
  openLoveMapQuestion(source) {
    let question;
    if (source === 'home') {
      question = HOME_DAILY_QUESTIONS[state.lovemap.homeCurrentIdx];
    } else {
      const dest = TRAVEL_DESTINATIONS.find(d => d.key === source);
      const destState = state.lovemap.destinations[source];
      if (destState.answeredCount >= dest.questions.length) {
        this.showDestinationMemories(source);
        return;
      }
      question = dest.questions[destState.answeredCount];
    }
    state.lovemapPhase = 'predict';
    state.lovemapTemp = { source, question };
    this.goTo('lovemap');
    this.renderLoveMapStep();
  },

  // 해당 여행지의 질문을 모두 마쳤을 때, 그동안 나눈 이야기를 모아서 보여줌
  showDestinationMemories(source) {
    const dest = TRAVEL_DESTINATIONS.find(d => d.key === source);
    const destState = state.lovemap.destinations[source];
    const n = state.names;

    this.goTo('lovemap');
    document.getElementById('lovemap-progress').textContent = `${dest.icon} ${escapeHtml(dest.name)} · 완료`;

    const body = document.getElementById('lovemap-body');
    body.innerHTML = `
      <div class="lovemap-question">${escapeHtml(dest.name)} 여행에서 나눈 우리의 이야기</div>
      <div class="lovemap-result">
        ${destState.answers.map(a => `
          <strong>${escapeHtml(a.q)}</strong><br>
          ${escapeHtml(n.A)}: ${escapeHtml(a.myAnswer || '(답변 없음)')}<br>
          ${escapeHtml(n.B)}: ${escapeHtml(a.aiAnswer)}
        `).join('<br><br>')}
      </div>
      <div class="lovemap-actions">
        <button class="btn-primary" onclick="App.exitLoveMap()">닫기</button>
      </div>
    `;
  },

  // 그동안 나눈 오늘의 질문(집) 답변들을 모아서 보여줌
  showHomeMemories() {
    if (state.lovemap.homeAnswers.length === 0) return;
    const n = state.names;

    this.goTo('lovemap');
    document.getElementById('lovemap-progress').textContent = '🏠 우리집 · 오늘의 질문 모음';

    const body = document.getElementById('lovemap-body');
    body.innerHTML = `
      <div class="lovemap-question">우리집에서 나눈 이야기</div>
      <div class="lovemap-result">
        ${state.lovemap.homeAnswers.map(a => `
          <strong>${escapeHtml(a.q)}</strong><br>
          ${escapeHtml(n.A)}: ${escapeHtml(a.myAnswer || '(답변 없음)')}<br>
          ${escapeHtml(n.B)}: ${escapeHtml(a.aiAnswer)}
        `).join('<br><br>')}
      </div>
      <div class="lovemap-actions">
        <button class="btn-primary" onclick="App.exitLoveMap()">닫기</button>
      </div>
    `;
  },

  exitLoveMap() {
    this.goTo('main');
    this.switchTab('emotion');
  },

  renderLoveMapStep() {
    const { source, question } = state.lovemapTemp;
    const n = state.names;
    const dest = source === 'home' ? null : TRAVEL_DESTINATIONS.find(d => d.key === source);

    document.getElementById('lovemap-progress').textContent = source === 'home'
      ? '🏠 오늘의 질문'
      : `${dest.icon} ${escapeHtml(dest.name)} · ${destCompletion(source)}%`;

    const body = document.getElementById('lovemap-body');

    if (state.lovemapPhase === 'predict') {
      body.innerHTML = `
        <div class="lovemap-question">${escapeHtml(question.q)}</div>
        <div class="lovemap-step">
          <label>${escapeHtml(n.B)}는 뭐라고 답할 것 같아요?</label>
          <textarea id="lovemap-predict" placeholder="파트너의 답을 예상해서 적어주세요"></textarea>
        </div>
        <button class="btn-primary" onclick="App.submitLoveMapPrediction()">다음</button>
      `;
    } else if (state.lovemapPhase === 'myAnswer') {
      body.innerHTML = `
        <div class="lovemap-question">${escapeHtml(question.q)}</div>
        <div class="lovemap-step">
          <label>이제 ${escapeHtml(n.A)}님의 답을 적어주세요</label>
          <textarea id="lovemap-myanswer" placeholder="솔직한 답변을 적어주세요"></textarea>
        </div>
        <button class="btn-primary" onclick="App.submitLoveMapAnswer()">답변 완료</button>
      `;
    } else {
      const tmp = state.lovemapTemp;
      let resultLabel, resultMsg;
      if (tmp.result === 'exact') {
        resultLabel = '🎯 정확히 맞췄어요!';
        resultMsg = `${escapeHtml(n.B)}의 마음을 정확하게 알고 있었네요.`;
      } else if (tmp.result === 'similar') {
        resultLabel = '😊 비슷하게 맞췄어요!';
        resultMsg = '방향은 비슷했어요. 조금씩 더 가까워지고 있어요.';
      } else {
        resultLabel = '✨ 새로운 발견!';
        resultMsg = '파트너에 대해 새로운 걸 알게 됐어요. 사랑지도가 더 풍부해지고 있어요.';
      }

      body.innerHTML = `
        <div class="lovemap-question">${escapeHtml(question.q)}</div>
        <div class="lovemap-result">
          <strong>${escapeHtml(n.A)}님이 예상한 답</strong><br>
          ${escapeHtml(tmp.prediction || '(예상 없음)')}<br><br>
          <strong>${escapeHtml(n.A)}님의 답변</strong><br>
          ${escapeHtml(tmp.myAnswer || '(답변 없음)')}<br><br>
          <strong>${escapeHtml(n.B)}의 실제 답변</strong><br>
          ${escapeHtml(question.aiAnswer)}
        </div>
        <div class="lovemap-compare ${tmp.result}">
          <strong>${resultLabel}</strong>
          <p>${resultMsg}</p>
        </div>
        ${tmp.unlockMsg ? `<div class="lovemap-unlock">${escapeHtml(tmp.unlockMsg).replace(/\n/g, '<br>')}</div>` : ''}
        <div class="lovemap-actions">
          ${source !== 'home' ? `<button class="btn-secondary" onclick="App.nextLoveMapQuestion()">다음 질문</button>` : ''}
          <button class="btn-primary" onclick="App.exitLoveMap()">${source === 'home' ? '닫기' : '여행 마치기'}</button>
        </div>
      `;
    }
  },

  submitLoveMapPrediction() {
    const val = document.getElementById('lovemap-predict').value.trim();
    state.lovemapTemp.prediction = val;
    state.lovemapPhase = 'myAnswer';
    this.renderLoveMapStep();
  },

  submitLoveMapAnswer() {
    const val = document.getElementById('lovemap-myanswer').value.trim();
    const tmp = state.lovemapTemp;
    tmp.myAnswer = val;

    const result = compareLoveMapAnswers(tmp.prediction, tmp.question.aiAnswer);
    tmp.result = result;

    state.stats.intimacy = clamp(state.stats.intimacy + (result === 'new' ? 1 : 2));

    if (tmp.source === 'home') {
      state.lovemap.homeAnswers.push({ q: tmp.question.q, prediction: tmp.prediction, myAnswer: val, aiAnswer: tmp.question.aiAnswer, result });
      state.lovemap.homeIndex += 1;
      state.lovemap.homeCurrentIdx = state.lovemap.homeIndex < HOME_DAILY_QUESTIONS.length
        ? state.lovemap.homeIndex
        : Math.floor(Math.random() * HOME_DAILY_QUESTIONS.length);
    } else {
      const destState = state.lovemap.destinations[tmp.source];
      const dest = TRAVEL_DESTINATIONS.find(d => d.key === tmp.source);
      const before = destCompletion(tmp.source);
      destState.answers.push({ q: tmp.question.q, prediction: tmp.prediction, myAnswer: val, aiAnswer: tmp.question.aiAnswer, result });
      destState.answeredCount += 1;
      const after = destCompletion(tmp.source);
      if (before < 50 && after >= 50) {
        tmp.unlockMsg = dest.completeMessage;
      }
    }

    state.lovemapPhase = 'reveal';
    this.renderLoveMapStep();
  },

  nextLoveMapQuestion() {
    this.openLoveMapQuestion(state.lovemapTemp.source);
  },

  /* ---------------- 실시간 날씨 ---------------- */
  loadWeather() {
    const apply = (lat, lon) => {
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`)
        .then(res => res.json())
        .then(data => {
          const cw = data.current_weather;
          if (!cw) return;
          const [icon] = WEATHER_CODES[cw.weathercode] || ['🌤️', '맑음'];
          const el = document.getElementById('top-weather');
          if (el) el.textContent = `${icon} ${Math.round(cw.temperature)}°C`;
        })
        .catch(() => {});
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => apply(pos.coords.latitude, pos.coords.longitude),
        () => apply(37.5665, 126.9780), // 위치 권한 거부 시 서울 기준
        { timeout: 4000 }
      );
    } else {
      apply(37.5665, 126.9780);
    }
  },
};

window.addEventListener('DOMContentLoaded', () => App.loadWeather());
