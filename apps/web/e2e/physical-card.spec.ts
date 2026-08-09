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
  await trigger.press('Space');await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'Fermer'})).toHaveCount(0);await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
});

test.skip('legacy standalone review card is removed',async({page,isMobile})=>{
  test.skip(isMobile,'review cards flip on fine hover pointers');await shell(page);let decision:unknown=null;
  const review={id:'synthetic-review',favoriteTitle:'Favori synthétique',favoriteUrl:'https://source.example.test/favorite',provider:'anilist',status:'PENDING',google:{anilist:'https://google.example.test/a',mangaupdates:'https://google.example.test/m'},candidates:[{id:'candidate-1',providerId:'101',canonicalTitle:'Candidat synthétique',url:'https://provider.example.test/work',type:'MANGA',year:2026}]};
  await page.route('**/api/v1/reviews/synthetic-review/resolve',async route=>{decision=await route.request().postDataJSON();await json(route,{ok:true})});
  await page.route('**/api/v1/reviews/synthetic-review',route=>json(route,review));
  await page.goto('/review/synthetic-review');const card=page.locator('.review-candidate-shell');await card.hover({position:{x:24,y:28}});await expect(card).toHaveClass(/is-flipped/);await expect(card).toHaveClass(/is-tilting/);expect(parseFloat(await card.evaluate(node=>getComputedStyle(node).getPropertyValue('--tilt-x')))).not.toBe(0);expect(parseFloat(await card.evaluate(node=>getComputedStyle(node).getPropertyValue('--tilt-y')))).not.toBe(0);
  const rotor=card.locator('.physical-card-rotor');await expect(rotor).toHaveCSS('transform',/matrix3d/);const back=card.locator('.physical-card-back');const backActions=card.locator('.physical-card-back-actions');await expect(backActions).toHaveCSS('filter','brightness(1.14)');await expect(backActions).toHaveCSS('transform',/matrix\(1, 0, 0, 1, 0, -2\)/);const backBox=await back.boundingBox();const actionsBox=await backActions.boundingBox();expect(actionsBox!.x).toBeLessThanOrEqual(backBox!.x);expect(actionsBox!.y).toBeLessThanOrEqual(backBox!.y);expect(actionsBox!.x+actionsBox!.width).toBeGreaterThanOrEqual(backBox!.x+backBox!.width);expect(actionsBox!.y+actionsBox!.height).toBeGreaterThanOrEqual(backBox!.y+backBox!.height);
  const actions=card.locator('.physical-card-back-actions');const add=page.getByRole('button',{name:'Ajouter'});const source=page.getByRole('link',{name:'Source de l’œuvre'});await expect(source).toHaveAttribute('href','https://provider.example.test/work');expect(await add.evaluate(node=>node.clientWidth)).toBe(await actions.evaluate(node=>node.clientWidth));expect(await source.evaluate(node=>node.clientWidth)).toBe(await actions.evaluate(node=>node.clientWidth));expect(await add.evaluate(node=>getComputedStyle(node,'::before').backgroundColor)).toBe('rgb(255, 181, 46)');expect(await source.evaluate(node=>getComputedStyle(node,'::before').backgroundColor)).toBe('rgb(11, 11, 14)');await expect(source).toHaveCSS('font-weight','800');await add.hover();await page.waitForTimeout(180);expect(await add.evaluate(node=>getComputedStyle(node,'::before').backgroundColor)).toBe('rgb(230, 161, 38)');expect(await add.locator('span').evaluate(node=>getComputedStyle(node).transform)).toContain('1.08');await source.hover();await page.waitForTimeout(180);expect(await source.evaluate(node=>getComputedStyle(node,'::before').backgroundColor)).toBe('rgb(39, 39, 49)');expect(await source.locator('span').evaluate(node=>getComputedStyle(node).transform)).toContain('1.08');await expect(source).toHaveCSS('text-decoration-line','none');await source.focus();await expect(source).toHaveCSS('outline-style','none');await expect(source).toHaveCSS('text-decoration-line','none');
  await page.mouse.move(1,1);await expect(card).not.toHaveClass(/is-flipped/);await card.hover();await page.mouse.move(1,1);await card.hover();await expect(card).toHaveClass(/is-flipped/);await page.mouse.move(1,1);await expect(card).not.toHaveClass(/is-flipped/);
  await card.hover();await page.getByRole('button',{name:'Ajouter'}).click();expect(decision).toEqual({candidateId:'candidate-1'});
});

test('legacy review URLs redirect to the home page without loading a standalone resolver',async({page})=>{
  await shell(page);
  await page.goto('/review/synthetic-review');
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.locator('.review-page')).toHaveCount(0);
  await expect(page.locator('.review-candidate-shell')).toHaveCount(0);
});

test('modal credits create removable private author and studio filters',async({page})=>{
  await shell(page);
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await page.route('**/api/v1/library*',route=>json(route,{items:[{...media,authors:[{name:'Synthetic Author',provider:'mangaupdates',sourceUrl:'https://provider.example.test/author'}],studios:[{name:'Synthetic Studio',provider:'anilist',sourceUrl:'https://provider.example.test/studio'}]}],total:1,nextOffset:1,hasMore:false}));
  await page.goto('/library');await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('tab',{name:'Informations'}).click();
  await dialog.getByRole('button',{name:'Synthetic Author'}).click();await expect(page.getByRole('button',{name:'Retirer le filtre auteur Synthetic Author'})).toBeVisible();await expect(page).toHaveURL(/author=Synthetic(?:\+|%20)Author/u);
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Retirer le filtre auteur Synthetic Author'}).click();await expect(page.getByRole('button',{name:'Retirer le filtre auteur Synthetic Author'})).toHaveCount(0);
  await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).click();const reopened=page.getByRole('dialog');await reopened.getByRole('tab',{name:'Informations'}).click();await reopened.getByRole('button',{name:'Synthetic Studio'}).click();await expect(page.getByRole('button',{name:'Retirer le filtre studio Synthetic Studio'})).toBeVisible();await expect(page).toHaveURL(/studio=Synthetic(?:\+|%20)Studio/u);
});

test('reduced motion opens the final card state directly',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await shell(page);
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await page.route('**/api/v1/library*',route=>json(route,{items:[media],total:1,nextOffset:1,hasMore:false}));
  await page.goto('/library');await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).click();await expect(page.getByRole('dialog')).toHaveCSS('transition-duration','0s');
});

test('library verso exposes its three accessible tabs and keeps parsed title provenance',async({page})=>{
  await shell(page);
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await page.route('**/api/v1/library*',route=>json(route,{items:[{...media,title:'Titre parsé',rawTitle:'Titre brut interdit',favoriteCount:2,format:'TV',seasonYear:2025,status:'Ongoing',metadata:{provider:'synthetic-provider',metadata:{description:'<p>Synopsis propre et long.</p>',language:'fr'}},progress:{kind:'episode',raw:'3',number:3,updatedAt:'2026-01-01T00:00:00.000Z'},availability:{kind:'episode',raw:'5',number:5,provider:'synthetic-provider'},latestReleaseDate:'2999-01-01T00:00:00.000Z',sources:[{mediaId:'synthetic-media',connector:'anilist',canonicalUrl:'https://synthetic.invalid/work',status:'AVAILABLE',domain:'synthetic.invalid',title:'Titre fournisseur',chapter:'5',provenance:{}}] }],total:1,nextOffset:1,hasMore:false}));
  await page.goto('/library');
  await page.getByRole('link',{name:'Aperçu de Titre parsé'}).click();
  const dialog=page.getByRole('dialog',{name:'Aperçu de Titre parsé'});await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab')).toHaveCount(3);await expect(dialog).toContainText('Titre parsé');await expect(dialog).not.toContainText('Titre brut interdit');await expect(dialog).toContainText('AniList');await expect(dialog).toContainText('Chapitre 5');await expect(dialog.locator('a[href="https://synthetic.invalid/work"]')).toHaveCount(1);await expect(dialog).not.toContainText('Disponibilité réelle');
  const copy=dialog.getByRole('button',{name:'Copier l’URL canonique'});await expect(copy).toHaveCSS('width','36px');await expect(copy).toHaveCSS('height','36px');await expect(copy.locator('svg')).toHaveCSS('pointer-events','none');await copy.hover();await expect(copy).toHaveCSS('background-color','rgb(39, 39, 49)');await copy.click();await expect(dialog).toContainText('URL canonique copiée.');
  await dialog.getByRole('tab',{name:'Informations'}).click();await expect(dialog).toContainText('Synopsis propre et long.');
  await dialog.getByRole('tab',{name:'Découvertes'}).click();await expect(dialog).toContainText('Aucune autre série reliée');
  if(!test.info().project.name.includes('mobile')){await dialog.getByRole('tab',{name:'Liens'}).focus();await page.keyboard.press('Tab');await expect(dialog.getByRole('tab',{name:'Informations'})).toBeFocused();}
  await page.keyboard.press('Escape');if(!test.info().project.name.includes('mobile')){await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('link',{name:'Aperçu de Titre parsé'})).toBeFocused();}
});

test('proved parts use the selector while other relations stay in discoveries',async({page})=>{
  await shell(page);
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await page.route('**/api/v1/library*',route=>json(route,{items:[{...media,relatedWorks:[{id:'synthetic-media',title:'Titre synthétique',type:'ANIME',format:'TV',seasonYear:2025,sequenceOrder:0,relationTypes:['CURRENT'],anilistId:'100',coverUrl:null},{id:'synthetic-sequel',title:'Suite synthétique',type:'ANIME',format:'ONA',seasonYear:2026,sequenceOrder:1,relationTypes:['SEQUENCE_MEMBER','SEQUEL'],anilistId:'101',coverUrl:null},{id:'synthetic-side',title:'Histoire synthétique',type:'ANIME',format:'SPECIAL',seasonYear:null,sequenceOrder:null,relationTypes:['SIDE_STORY'],anilistId:'102',coverUrl:null,status:'Ongoing',progress:{kind:'episode',raw:'3',number:3,updatedAt:'2026-01-01T00:00:00.000Z'},availability:{kind:'episode',raw:'5',number:5,provider:'synthetic-provider'}}]}],total:1,nextOffset:1,hasMore:false}));
  await page.goto('/library');await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).click();const dialog=page.getByRole('dialog',{name:'Aperçu de Titre synthétique'});
  const toggle=dialog.locator('.media-card-back-header > .media-card-related-toggle');await expect(toggle).toHaveAttribute('aria-expanded','false');await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(dialog.getByRole('tab')).toHaveCount(0);await expect(dialog.locator('.related-work-row')).toHaveCount(2);await expect(dialog.getByRole('region',{name:'Saisons et parties de la même œuvre'})).toContainText('Suite synthétique');await expect(dialog).toContainText('Partie 2');await expect(dialog).not.toContainText('ONA · 2026');await expect(dialog).not.toContainText('Histoire synthétique');
  await toggle.click();await expect(dialog.getByRole('tab')).toHaveCount(3);await dialog.getByRole('tab',{name:/Découvertes/}).click();await expect(dialog).toContainText('Histoire synthétique');await expect(dialog).toContainText('3 / 5');await expect(dialog).toContainText('Ongoing');
});

test('related navigation replaces every modal section, caps discoveries, handles errors, and resets on reopen',async({page})=>{
  await shell(page);const parts=Array.from({length:5},(_,index)=>({id:`synthetic-part-${index}`,title:`Partie synthétique ${index+1}`,type:'ANIME',format:'TV',seasonYear:2025+index,sequenceOrder:index,relationTypes:['SEQUENCE_MEMBER'],coverUrl:null}));const discoveries=Array.from({length:26},(_,index)=>({id:`synthetic-discovery-${index}`,title:`Découverte synthétique ${index+1}`,type:'ANIME',format:'SPECIAL',sequenceOrder:null,relationTypes:['SIDE_STORY'],coverUrl:null}));const root={...media,id:'synthetic-part-0',title:'Partie synthétique 1',type:'ANIME',relatedWorks:[...parts,...discoveries],favorites:[{bookmarkId:'root-favorite',url:'https://synthetic.invalid/root',title:'Raw',parsedTitle:'Favori racine',progression:null,device:'Synthetic',parserId:'shared',parserVersion:1,provenance:{}}]};
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await page.route('**/api/v1/library/synthetic-part-0/related/synthetic-part-1',route=>json(route,{...root,id:'synthetic-part-1',title:'Partie synthétique 2',format:'ONA',favorites:[],sources:[],providerPages:[],metadata:{provider:'anilist',metadata:{description:'Description remplacée'}},relatedWorks:[...parts,...discoveries]}));
  await page.route('**/api/v1/library*',route=>json(route,{items:[root],total:1,nextOffset:1,hasMore:false}));
  await page.goto('/library');const trigger=page.getByRole('link',{name:'Aperçu de Partie synthétique 1'});await trigger.click();let dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:/Partie synthétique 1/}).click();await expect(dialog.locator('.related-work-row')).toHaveCount(5);await expect(dialog.locator('.related-work-row.active')).toBeDisabled();await dialog.getByRole('button',{name:/Partie synthétique 2/}).click();await expect(dialog.locator('.media-card-back-header .media-card-back-heading h2')).toHaveText('Partie synthétique 2');await expect(dialog.locator('.media-card-back-content')).toHaveAttribute('aria-busy','false');await expect(dialog).not.toContainText('Favori racine');await expect(dialog.getByRole('tab',{name:/Liens/})).toHaveAttribute('aria-selected','true');
  await dialog.getByRole('tab',{name:/Découvertes/}).click();await expect(dialog.locator('.related-work-card')).toHaveCount(24);await page.route('**/api/v1/library/synthetic-part-0/related/synthetic-discovery-0',route=>route.abort());await dialog.locator('.related-work-card').filter({hasText:'Découverte synthétique 1'}).first().click();await expect(dialog).toContainText('Impossible de charger cette œuvre');await expect(dialog.locator('.media-card-back-header .media-card-back-heading h2')).toHaveText('Partie synthétique 2');
  await page.keyboard.press('Escape');await trigger.click();dialog=page.getByRole('dialog');await expect(dialog).toContainText('Partie synthétique 1');await expect(dialog).not.toContainText('Partie synthétique 2');
});

test('touch tap opens and closes the media card',async({page,isMobile})=>{
  test.skip(!isMobile,'touch project only');await shell(page);
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await page.route('**/api/v1/library*',route=>json(route,{items:[media],total:1,nextOffset:1,hasMore:false}));
  await page.goto('/library');await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).tap();await expect(page.getByRole('dialog')).toBeVisible();await page.getByTestId('media-card-backdrop').tap({position:{x:2,y:2}});await expect(page.getByRole('dialog')).toHaveCount(0);
});
