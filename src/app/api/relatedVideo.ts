import type { NextApiRequest, NextApiResponse } from 'next';

type Video = {
    id: number;
    title: string;
    channel: string;
    views: string;
    thumbnail: string;
    time: string;
};

let videos: Video[] = [
    {
        id: 1,
        title: "تاريخ المذاهب الأربعة وأهمية التمذهب لطالب العلم.",
        channel: "مصطفى البدري",
        views: "123K views",
        thumbnail: "/img/تاريخ المذاهب الأربعة وأهمية التمذهب لطالب العلم - مصطفى البدري.jpg",
        time: "3 days ago"
    },
    // Add more initial video data here
];

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    switch (req.method) {
        case 'GET':
            if (req.query.id) {
                const id = parseInt(req.query.id as string);
                const video = videos.find(video => video.id === id);
                if (video) {
                    res.status(200).json(video);
                } else {
                    res.status(404).json({ message: `Video with id ${id} not found` });
                }
                return;
            }
            else {
                res.status(200).json(videos);
            }
            break;
        case 'POST':
            const newVideo: Video = req.body;
            newVideo.id = videos.length + 1;
            videos.push(newVideo);
            res.status(201).json(newVideo);
            break;
        case 'PUT':
            const { id, ...updatedVideo } = req.body;
            videos = videos.map(video => video.id === id ? { ...video, ...updatedVideo } : video);
            res.status(200).json({ message: 'Video updated successfully' });
            break;
        case 'DELETE':
            const { id: deleteId } = req.body;
            videos = videos.filter(video => video.id !== deleteId);
            res.status(200).json({ message: 'Video deleted successfully' });
            break;
        default:
            res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
            res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}