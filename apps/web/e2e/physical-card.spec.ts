import {expect,test,type Page,type Route} from '@playwright/test';

const json=(route:Route,body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
const media={id:'synthetic-media',title:'Titre synthétique',type:'MANGA',favoriteCount:1,coverUrl:null};

async function shell(page:Page){
  await page.route('**/api/v1/auth/session',route=>json(route,{user:{id:'synthetic-user',email:'user@example.test',role:'member'}}));
  await page.route('**/api/v1/reviews?*',route=>json(route,{items:[],pendingCount:0}));
  await page.route('**/api/v1/reviews',route=>json(route,{items:[],pendingCount:0}));
}

test('media click flips into a centred vertical modal without navigation and restores focus',async({page,isMobile})=>{
  test.skip(isMobile,'desktop geometry assertion');await shell(page);
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await page.route('**/api/v1/library*',route=>json(route,{items:[media],total:1,nextOffset:1,hasMore:false}));
  await page.goto('/library');const trigger=page.getByRole('link',{name:'Aperçu de Titre synthétique'});await trigger.click({position:{x:8,y:12}});
  await expect(page).toHaveURL(/\/library$/);const dialog=page.getByRole('dialog',{name:'Aperçu de Titre synthétique'});await expect(dialog).toBeVisible();await expect(page.locator('.physical-card-modal')).toHaveCount(0);await expect(page.locator('.physical-card-slot.has-open-card > .media-card')).toHaveCount(1);await page.waitForTimeout(550);const box=await dialog.boundingBox();expect(box!.width/box!.height).toBeCloseTo(2/3,1);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await trigger.click();const backdrop=page.getByTestId('media-card-backdrop');await expect(backdrop).toBeVisible();await backdrop.click({position:{x:2,y:2}});await expect(backdrop).toHaveClass(/is-closing/);await expect(dialog).toHaveCount(0);await expect(page).toHaveURL(/\/library$/);
  await trigger.press('Space');await expect(dialog).toBeVisible();await page.getByRole('button',{name:'Fermer'}).click();await expect(page.getByTestId('media-card-backdrop')).toHaveClass(/is-closing/);await expect(page.getByTestId('media-card-backdrop')).toHaveCount(0);await expect(dialog).toBeVisible();
});

test('review hover reveals existing resolve and provider source actions',async({page,isMobile})=>{
  test.skip(isMobile,'review cards flip on fine hover pointers');await shell(page);let decision:unknown=null;
  const review={id:'synthetic-review',favoriteTitle:'Favori synthétique',favoriteUrl:'https://source.example.test/favorite',provider:'anilist',status:'PENDING',google:{anilist:'https://google.example.test/a',mangaupdates:'https://google.example.test/m'},candidates:[{id:'candidate-1',providerId:'101',canonicalTitle:'Candidat synthétique',url:'https://provider.example.test/work',type:'MANGA',year:2026}]};
  await page.route('**/api/v1/reviews/synthetic-review/resolve',async route=>{decision=await route.request().postDataJSON();await json(route,{ok:true})});
  await page.route('**/api/v1/reviews/synthetic-review',route=>json(route,review));
  await page.goto('/review/synthetic-review');const card=page.locator('.review-candidate-shell');await card.hover();await expect(card).toHaveClass(/is-flipped/);
  const rotor=card.locator('.physical-card-rotor');await expect(rotor).toHaveCSS('transform',/matrix3d\(-1, 0, 0, 0, 0, 1/);expect(await rotor.evaluate(node=>getComputedStyle(node).transform.includes('matrix3d'))).toBe(true);
  const actions=card.locator('.physical-card-back-actions');const add=page.getByRole('button',{name:'Ajouter'});const source=page.getByRole('link',{name:'Source de l’œuvre'});await expect(source).toHaveAttribute('href','https://provider.example.test/work');expect(await add.evaluate(node=>node.clientWidth)).toBe(await actions.evaluate(node=>node.clientWidth));expect(await source.evaluate(node=>node.clientWidth)).toBe(await actions.evaluate(node=>node.clientWidth));expect(await add.evaluate(node=>getComputedStyle(node,'::before').backgroundColor)).toBe('rgb(29, 29, 36)');expect(await source.evaluate(node=>getComputedStyle(node,'::before').backgroundColor)).toBe('rgb(11, 11, 14)');await expect(source).toHaveCSS('font-weight','800');await add.hover();await page.waitForTimeout(180);expect(await add.evaluate(node=>getComputedStyle(node,'::before').backgroundColor)).toBe('rgb(48, 48, 57)');await source.hover();await page.waitForTimeout(180);expect(await source.evaluate(node=>getComputedStyle(node,'::before').backgroundColor)).toBe('rgb(39, 39, 49)');await expect(source).toHaveCSS('text-decoration-line','none');await source.focus();await expect(source).toHaveCSS('outline-style','none');await expect(source).toHaveCSS('text-decoration-line','none');
  await page.mouse.move(1,1);await expect(card).not.toHaveClass(/is-flipped/);await card.hover();await page.mouse.move(1,1);await card.hover();await expect(card).toHaveClass(/is-flipped/);await page.mouse.move(1,1);await expect(card).not.toHaveClass(/is-flipped/);
  await card.hover();await page.getByRole('button',{name:'Ajouter'}).click();expect(decision).toEqual({candidateId:'candidate-1'});
});

test('reduced motion opens the final card state directly',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await shell(page);
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await page.route('**/api/v1/library*',route=>json(route,{items:[media],total:1,nextOffset:1,hasMore:false}));
  await page.goto('/library');await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).click();await expect(page.getByRole('dialog')).toHaveCSS('transition-duration','0s');
});

test('touch tap opens and closes the media card',async({page,isMobile})=>{
  test.skip(!isMobile,'touch project only');await shell(page);
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await page.route('**/api/v1/library*',route=>json(route,{items:[media],total:1,nextOffset:1,hasMore:false}));
  await page.goto('/library');await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).tap();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Fermer'}).tap();await expect(page.getByRole('dialog')).toHaveCount(0);
});
