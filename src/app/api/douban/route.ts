import { NextResponse } from 'next/server';

/** 豆瓣数据源已停用；首页影视资料与海报统一迁移至 TMDB。 */
export async function GET() {
  return NextResponse.json(
    { error: '豆瓣数据源已停用，请使用 TMDB 影视资料服务' },
    { status: 410 },
  );
}
