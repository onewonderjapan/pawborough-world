// 玩家短途体验路线定义（工单 U08，冻结方案）
// 紧凑三选一：附近尝鲜（短步行）、骑车巡游（官方长街巡礼）、自由收集（现有atlas逻辑）

export const PLAYER_ROUTES = [
  {
    id: 'taste',
    title: '附近尝鲜',
    subtitle: '短步行寻味',
    mode: 'walk',
    description: '围绕中心广场品尝三道招牌美味，步行可达，适合初来乍到的新玩家。',
    foods: ['changfen', 'boboji', 'xiaolongbao'],
    badgeId: 'route-taste',
    badgeTitle: '尝鲜漫游章',
  },
  {
    id: 'cruise',
    title: '骑车巡游',
    subtitle: '跨街长途巡游',
    mode: 'bike',
    description: '沿官方推荐漫游路线骑行，穿行豫园到方浜中路，巡礼八方风味小吃。',
    foods: [
      'changfen',
      'boboji',
      'xiaolongbao',
      'roujiamo',
      'naidoufu',
      'qingbuliang',
      'waguan-tang',
      'lvrou-huoshao',
    ],
    badgeId: 'route-cruise',
    badgeTitle: '骑行巡游章',
  },
  {
    id: 'free',
    title: '自由收集',
    subtitle: '全域漫游',
    mode: 'free',
    description: '无固定路线约束，自由穿梭街巷，随心探索并收集全部48味地方特色小吃。',
    foods: null,
    badgeId: null,
    badgeTitle: null,
  },
];

export const ROUTE_IDS = ['taste', 'cruise', 'free'];
export const PLAYER_ROUTES_BY_ID = new Map(PLAYER_ROUTES.map(r => [r.id, Object.freeze({ ...r })]));

export function getRouteDefinition(routeId) {
  return PLAYER_ROUTES_BY_ID.get(routeId) ?? PLAYER_ROUTES_BY_ID.get('free');
}
