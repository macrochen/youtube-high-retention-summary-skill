import sys
import json
import time
import os
import subprocess
from urllib.parse import quote

def main():
    if len(sys.argv) < 2:
        print("Usage: python batch_processor.py <path_to_json> [sleep_interval_in_seconds]")
        sys.exit(1)

    json_path = sys.argv[1]
    
    sleep_time = 15
    if len(sys.argv) >= 3:
        try:
            sleep_time = int(sys.argv[2])
        except ValueError:
            print("⚠️ 无效的休眠时间，将使用默认的 15 秒。")
    
    if not os.path.exists(json_path):
        print(f"File not found: {json_path}")
        sys.exit(1)
        
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            videos = json.load(f)
    except Exception as e:
        print(f"Error reading JSON file: {e}")
        sys.exit(1)

    if not videos:
        print("队列为空。")
        sys.exit(0)

    # Calculate remaining tasks
    remaining_videos = [v for v in videos if not v.get('processed', False)]
    
    if not remaining_videos:
        print("所有任务均已处理完毕！如果需要重新处理，请清理 JSON 文件中的 'processed' 字段。")
        sys.exit(0)

    print(f"✅ 发现 {len(remaining_videos)} 个待总结的视频 (共 {len(videos)} 个)，启动慢速批量执行队列...\n")

    for i, video in enumerate(videos):
        if video.get('processed', False):
            continue
            
        title = video.get('title', 'Unknown')
        url = video.get('url', '')
        
        if not url:
            print(f"⚠️ 视频没有提供有效的 URL，跳过。")
            video['processed'] = True
            save_checkpoint(json_path, videos)
            continue

        print(f"🚀 正在发射任务: {title}")
        print(f"    URL: {url}")
        
        encoded_url = quote(url, safe='')
        target_gem_url = f"https://gemini.google.com/u/0/gem/df372934aec1?auto_prompt={encoded_url}"
        
        try:
            subprocess.run(["open", target_gem_url], check=True)
            # 标记为已处理并保存
            video['processed'] = True
            save_checkpoint(json_path, videos)
        except Exception as e:
            print(f"    ❌ 打开浏览器失败: {e}")
            print(f"    由于执行失败，任务中断。你可以稍后重新运行此命令以继续。")
            sys.exit(1)
        
        # 检查是否还有剩余未处理的视频
        has_more = any(not v.get('processed', False) for v in videos)
        
        if has_more:
            print(f"    ⏳ 任务已发送给 Gemini。当前终端已进入休眠 ({sleep_time} 秒以防被频控拦截)。")
            print(f"    (提示: 即使你现在关闭终端或按 Ctrl+C，下次重新执行也能断点续传)\n")
            
            try:
                time.sleep(sleep_time)
            except KeyboardInterrupt:
                print("\n🛑 用户手动中断！由于加入了断点续传，你下次重新执行同一个命令即可继续。")
                sys.exit(0)

    print("\n🎉 所有批量任务已发射完毕！")

def save_checkpoint(path, data):
    # 临时文件保证原子写入
    temp_path = path + ".tmp"
    with open(temp_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(temp_path, path)

if __name__ == "__main__":
    main()
