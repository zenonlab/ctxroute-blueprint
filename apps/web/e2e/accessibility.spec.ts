import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const json=(route:Route,body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});

async function assertWcag(page:Page,path:string){
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  expect(result.violations,`${path}: ${result.violations.map(v=>`${v.id} (${v.nodes.length})`).join(', ')}`).toEqual([]);
}

test('public and authentication pages have no automated WCAG A/AA violations',async({page})=>{
  await page.route('**/api/v1/releases',route=>json(route,{items:[]}));
  await page.route('**/api/v1/calendar',route=>json(route,{items:[]}));
  await page.route('**/api/v1/library*',route=>json(route,{},401));
  await page.route('**/api/v1/auth/session',route=>json(route,{},401));
  for(const path of ['/','/calendar','/library','/settings','/login','/register'])await assertWcag(page,path);
});

test('authenticated library has no automated WCAG A/AA violations',async({page})=>{
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[{value:'MANGA',count:1}],themes:[],statuses:[],years:[],formats:[],languages:[],contentRatings:[],demographics:[]}));
  await page.route('**/api/v1/library*',route=>json(route,{items:[{id:'accessible-work',title:'Œuvre accessible',type:'MANGA',favoriteCount:1,coverUrl:null}],total:1,nextOffset:1,hasMore:false}));
  await assertWcag(page,'/library');
});

test('authenticated detail and settings pages have no automated WCAG A/AA violations',async({page})=>{
  await page.route('**/api/v1/auth/session',route=>json(route,{user:{email:'alice@example.test',role:'member'}}));
  await page.route('**/api/v1/extension/devices',route=>json(route,{items:[]}));
  await page.route('**/api/v1/calendar/feeds',route=>json(route,{items:[]}));
  await page.route('**/api/v1/library/accessible-work',route=>json(route,{id:'accessible-work',title:'Œuvre accessible',type:'MANGA',favoriteCount:1,coverUrl:null,favorites:[{bookmarkId:'b1',url:'https://source.example/work',title:'Mon favori',device:'Chrome'}],metadata:null}));
  await assertWcag(page,'/library/accessible-work');
  await assertWcag(page,'/settings');
});
