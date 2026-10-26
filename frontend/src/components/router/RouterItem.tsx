import { lazy, ReactNode } from 'react';
import { RouteObject } from 'react-router-dom';

const TabLayout = lazy(() => import('@/components/layouts/tab/TabLayout'));

export type IRouterItem = RouteObject & {
  page: ReactNode;
  prefix: string;
  path: string;
};
const RouterItems: Array<IRouterItem> = [
  {
    page: <TabLayout />,
    prefix: '',
    path: '/',
  },
];
export default RouterItems;
