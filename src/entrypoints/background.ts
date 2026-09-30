import { toggleSidebarOnActionClick } from '@/shared/sidebar-toggle';

export default defineBackground(() => {
  toggleSidebarOnActionClick(import.meta.env.FIREFOX);
});
