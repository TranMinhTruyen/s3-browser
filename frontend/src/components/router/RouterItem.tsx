import { lazy, ReactNode } from 'react';
import { RouteObject } from 'react-router-dom';

const Home = lazy(() => import('@/pages/home/Page'));

export type IRouterItem = RouteObject & {
  page: ReactNode;
  prefix: string;
  path: string;
};
const RouterItems: Array<IRouterItem> = [
  {
    page: <Home />,
    prefix: '',
    path: '/',
  },
];
export default RouterItems;
