/**
 * Модули корабля. Улучшения дают бонусы к регенерации или лимитам.
 */
export const SHIP_MODULES = [
  { id: 'hull_plating', name: 'Усиленная обшивка', description: '+5 к макс. корпусу', cost: 30, maxLevel: 3, resource: 'hull', bonus: 5 },
  { id: 'capacitor', name: 'Доп. конденсатор', description: '+10 к макс. энергии', cost: 25, maxLevel: 2, resource: 'energy', bonus: 10 },
  { id: 'scrap_hold', name: 'Расширенный трюм', description: '+50 к макс. лому', cost: 20, maxLevel: 4, resource: 'scrap', bonus: 50 },
  { id: 'quarters', name: 'Жилые кварталы', description: '+5 к макс. экипажу', cost: 35, maxLevel: 2, resource: 'crew', bonus: 5 },
  { id: 'gyro', name: 'Стабилизатор', description: '+10 к макс. стабильности', cost: 28, maxLevel: 2, resource: 'stability', bonus: 10 },
];
