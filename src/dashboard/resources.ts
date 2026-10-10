/** Fixed official information links; renderer input never becomes an arbitrary URL. */
export function resourceURL(id: unknown): string | undefined {
  switch (id) {
    case 'student-timetable': return 'https://campusapps.itsc.cuhk.edu.hk/store/stu/apps.aspx';
    case 'mobile-app-guide': return 'https://www.itsc.cuhk.edu.hk/all-it/phone-mobile/cuhk-mobile-app-store/';
    default: return undefined;
  }
}
