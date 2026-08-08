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
  await expect(page).toHaveURL(/\/library$/);const dialog=page.getByRole('dialog',{name:'Aperçu de Titre synthétique'});await expect(dialog).toBeVisible();await expect(dialog).toHaveCSS('aspect-ratio','2 / 3');
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
  await trigger.click();await page.getByTestId('media-card-backdrop').click({position:{x:2,y:2}});await expect(dialog).toHaveCount(0);
  await trigger.press('Space');await expect(dialog).toBeVisible();await page.getByRole('button',{name:'Fermer'}).click();await expect(trigger).toBeFocused();
});

test('review hover reveals existing resolve and provider source actions',async({page,isMobile})=>{
  test.skip(isMobile,'review cards flip on fine hover pointers');await shell(page);let decision:unknown=null;
  const review={id:'synthetic-review',favoriteTitle:'Favori synthétique',favoriteUrl:'https://source.example.test/favorite',provider:'anilist',status:'PENDING',google:{anilist:'https://google.example.test/a',mangaupdates:'https://google.example.test/m'},candidates:[{id:'candidate-1',providerId:'101',canonicalTitle:'Candidat synthétique',url:'https://provider.example.test/work',type:'MANGA',year:2026}]};
  await page.route('**/api/v1/reviews/synthetic-review/resolve',async route=>{decision=await route.request().postDataJSON();await json(route,{ok:true})});
  await page.route('**/api/v1/reviews/synthetic-review',route=>json(route,review));
  await page.goto('/review/synthetic-review');const card=page.locator('.review-candidate-shell');await card.hover();await expect(card).toHaveClass(/is-flipped/);
  const source=page.getByRole('link',{name:'Source de l’œuvre'});await expect(source).toHaveAttribute('href','https://provider.example.test/work');await page.mouse.move(1,1);await expect(card).not.toHaveClass(/is-flipped/);
  await card.hover();await page.getByRole('button',{name:'Ajouter'}).click();expect(decision).toEqual({candidateId:'candidate-1'});
});

test('reduced motion opens the final card state directly',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await shell(page);
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await page.route('**/api/v1/library*',route=>json(route,{items:[media],total:1,nextOffset:1,hasMore:false}));
  await page.goto('/library');await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).click();await expect(page.locator('.physical-card-modal')).toHaveCSS('transition-duration','0s');
});

test('touch tap opens and closes the media card',async({page,isMobile})=>{
  test.skip(!isMobile,'touch project only');await shell(page);
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await page.route('**/api/v1/library*',route=>json(route,{items:[media],total:1,nextOffset:1,hasMore:false}));
  await page.goto('/library');await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).tap();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Fermer'}).tap();await expect(page.getByRole('dialog')).toHaveCount(0);
});
